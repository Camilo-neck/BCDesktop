//! SIA catalog access: a reusable session plus bulk operations with progress.

pub mod client;
pub mod constants;
pub mod parser;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Mutex;

pub use client::{CareerListing, SiaSession};
pub use parser::DropdownOption;

use crate::error::{Error, Result};
use crate::model::{CareerRef, Course, CoursePrereqs, CourseSummary};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub current: String,
}

/// Shared flag the UI flips to stop a long scrape between requests.
#[derive(Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    pub fn reset(&self) {
        self.0.store(false, Ordering::Relaxed);
    }
    pub fn check(&self) -> Result<()> {
        if self.0.load(Ordering::Relaxed) {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// Run `$body` with the shared session bound to `$s`, opening it when missing or
/// stale and retrying once on an expired session or a timeout. A macro instead
/// of a closure-taking helper keeps the resulting futures `Send`.
macro_rules! with_session {
    ($self:ident, |$s:ident| $body:expr) => {{
        let mut guard = $self.session.lock().await;
        let mut retried = false;
        loop {
            if guard.as_ref().is_none_or(|s| s.is_stale()) {
                *guard = Some(SiaSession::open($self.timeout).await?);
            }
            let $s = guard.as_mut().expect("session just opened");
            match $body {
                Err(Error::SiaState(_) | Error::Timeout) if !retried => {
                    log::info!("SIA session lost, reopening");
                    retried = true;
                    *guard = None;
                }
                other => break other,
            }
        }
    }};
}

/// Owns one long-lived session (the SIA is slow to warm up) and opens extra
/// ones only for parallel bulk work. Expired sessions are reopened and the
/// failed step retried once.
pub struct SiaService {
    timeout: Duration,
    session: Mutex<Option<SiaSession>>,
}

impl SiaService {
    pub fn new(timeout: Duration) -> SiaService {
        SiaService {
            timeout,
            session: Mutex::new(None),
        }
    }

    pub async fn levels(&self) -> Result<Vec<DropdownOption>> {
        with_session!(self, |s| Ok::<_, Error>(s.levels()))
    }

    pub async fn campuses(&self, level: &str) -> Result<Vec<DropdownOption>> {
        with_session!(self, |s| s.campuses(level).await)
    }

    pub async fn faculties(&self, level: &str, campus: &str) -> Result<Vec<DropdownOption>> {
        with_session!(self, |s| s.faculties(level, campus).await)
    }

    pub async fn plans(
        &self,
        level: &str,
        campus: &str,
        faculty: &str,
    ) -> Result<Vec<DropdownOption>> {
        with_session!(self, |s| s.plans(level, campus, faculty).await)
    }

    async fn ensure_career(session: &mut SiaSession, career: &CareerRef) -> Result<CareerListing> {
        let same = session
            .current_career()
            .is_some_and(|c| c.key() == career.key());
        if !same {
            session.set_career(career).await?;
        }
        Ok(session.listing().cloned().expect("career set"))
    }

    /// Courses offered for a career (the catalog table), without opening them.
    pub async fn list_courses(&self, career: &CareerRef) -> Result<CareerListing> {
        with_session!(self, |s| Self::ensure_career(s, career).await)
    }

    /// Open each requested course. Failures are reported per course so one bad
    /// page does not lose the rest.
    pub async fn fetch_courses(
        &self,
        career: &CareerRef,
        codes: &[String],
        cancel: &Cancel,
        on_progress: impl Fn(Progress),
    ) -> Result<Vec<(String, Result<Course>)>> {
        let listing = self.list_courses(career).await?;
        let mut out = Vec::with_capacity(codes.len());
        for (i, code) in codes.iter().enumerate() {
            cancel.check()?;
            let Some(summary) = listing.courses.iter().find(|c| &c.code == code).cloned() else {
                out.push((
                    code.clone(),
                    Err(Error::NotFound(format!(
                        "{code} no aparece en la oferta de la carrera"
                    ))),
                ));
                continue;
            };
            on_progress(Progress {
                done: i,
                total: codes.len(),
                current: summary.name.clone(),
            });
            let result = with_session!(self, |s| match Self::ensure_career(s, career).await {
                Ok(_) => s.fetch_course(&summary).await,
                Err(e) => Err(e),
            });
            out.push((code.clone(), result));
        }
        on_progress(Progress {
            done: codes.len(),
            total: codes.len(),
            current: String::new(),
        });
        Ok(out)
    }

    /// Prerequisites of every course of a career, using `parallel` independent
    /// sessions so a 60-course plan takes a fraction of the sequential time.
    pub async fn fetch_all_prereqs(
        &self,
        career: &CareerRef,
        parallel: usize,
        cancel: &Cancel,
        on_progress: impl Fn(Progress) + Send + Sync,
    ) -> Result<Vec<CoursePrereqs>> {
        let listing = self.list_courses(career).await?;
        let total = listing.courses.len();
        let workers = parallel.clamp(1, 6).min(total.max(1));
        let done = AtomicUsize::new(0);
        let chunks: Vec<Vec<CourseSummary>> = (0..workers)
            .map(|w| {
                listing
                    .courses
                    .iter()
                    .skip(w)
                    .step_by(workers)
                    .cloned()
                    .collect()
            })
            .collect();

        let timeout = self.timeout;
        let progress = &on_progress;
        let done_ref = &done;
        let jobs = chunks.into_iter().map(|chunk| async move {
            let mut session = SiaSession::open(timeout).await?;
            session.set_career(career).await?;
            let mut out = Vec::with_capacity(chunk.len());
            for summary in chunk {
                cancel.check()?;
                if session.is_stale() {
                    session = SiaSession::open(timeout).await?;
                    session.set_career(career).await?;
                }
                match session.fetch_prereqs(&summary).await {
                    Ok(p) => out.push(p),
                    Err(e @ (Error::Cancelled | Error::Network(_))) => return Err(e),
                    Err(e) => log::warn!("prereqs of {} failed: {e}", summary.code),
                }
                let n = done_ref.fetch_add(1, Ordering::Relaxed) + 1;
                progress(Progress {
                    done: n,
                    total,
                    current: summary.name.clone(),
                });
            }
            Ok::<_, Error>(out)
        });
        let results = futures::future::join_all(jobs).await;
        let mut all = Vec::with_capacity(total);
        for r in results {
            all.extend(r?);
        }
        all.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(all)
    }
}
