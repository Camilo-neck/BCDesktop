//! Prerequisite graph of a study plan.
//!
//! The web version built a networkx graph and shipped pyvis-generated HTML (with
//! Tailwind from a CDN) into an iframe. Here the core returns plain nodes and
//! edges with a layered layout already computed, and the UI draws them.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::model::{Condition, CoursePrereqs, Typology};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    /// Passed according to the academic history.
    Approved,
    /// Not passed, and every blocking prerequisite is passed.
    Available,
    /// Some blocking prerequisite is still missing.
    Locked,
    /// Prerequisite that belongs to another plan (no data about it).
    External,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub code: String,
    pub name: String,
    pub credits: u8,
    pub typology: Typology,
    pub status: NodeStatus,
    pub layer: u32,
    pub order: u32,
    pub conditions: Vec<Condition>,
    /// Codes of plan courses that list this one as a prerequisite.
    pub unlocks: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub condition: u32,
    /// True when the target needs every course of the condition.
    pub all: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub courses: u32,
    pub approved: u32,
    pub available: u32,
    pub locked: u32,
    pub approved_credits: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub layers: u32,
    pub stats: Stats,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    pub hide_leveling: bool,
    pub hide_external: bool,
}

fn is_blocking(c: &Condition) -> bool {
    c.kind == "M"
}

fn satisfied(c: &Condition, passed: &HashSet<&str>) -> bool {
    c.courses
        .iter()
        .filter(|p| passed.contains(p.code.as_str()))
        .count()
        >= c.needed()
}

pub fn build(plan: &[CoursePrereqs], passed: &[String], opts: &Options) -> Graph {
    let passed: HashSet<&str> = passed.iter().map(String::as_str).collect();
    let courses: Vec<&CoursePrereqs> = plan
        .iter()
        .filter(|c| !(opts.hide_leveling && c.typology == Typology::Nivelacion))
        .collect();
    let in_plan: HashSet<&str> = courses.iter().map(|c| c.code.as_str()).collect();

    let mut nodes: Vec<Node> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut edges = Vec::new();

    for c in &courses {
        let status = if passed.contains(c.code.as_str()) {
            NodeStatus::Approved
        } else if c
            .conditions
            .iter()
            .filter(|k| is_blocking(k))
            .all(|k| satisfied(k, &passed))
        {
            NodeStatus::Available
        } else {
            NodeStatus::Locked
        };
        index.insert(c.code.clone(), nodes.len());
        nodes.push(Node {
            code: c.code.clone(),
            name: c.name.clone(),
            credits: c.credits,
            typology: c.typology,
            status,
            layer: 0,
            order: 0,
            conditions: c.conditions.clone(),
            unlocks: Vec::new(),
        });
    }

    for c in &courses {
        for cond in &c.conditions {
            for p in &cond.courses {
                let known = in_plan.contains(p.code.as_str());
                if !known && opts.hide_external {
                    continue;
                }
                if !known && !index.contains_key(&p.code) {
                    index.insert(p.code.clone(), nodes.len());
                    nodes.push(Node {
                        code: p.code.clone(),
                        name: p.name.clone(),
                        credits: 0,
                        typology: Typology::Other,
                        status: if passed.contains(p.code.as_str()) {
                            NodeStatus::Approved
                        } else {
                            NodeStatus::External
                        },
                        layer: 0,
                        order: 0,
                        conditions: Vec::new(),
                        unlocks: Vec::new(),
                    });
                }
                if p.code == c.code {
                    continue;
                }
                edges.push(Edge {
                    from: p.code.clone(),
                    to: c.code.clone(),
                    kind: cond.kind.clone(),
                    condition: cond.number,
                    all: cond.all,
                });
                let i = index[&p.code];
                if !nodes[i].unlocks.contains(&c.code) {
                    nodes[i].unlocks.push(c.code.clone());
                }
            }
        }
    }

    let layers = layout(&mut nodes, &edges, &index);
    let plan_nodes = nodes.iter().filter(|n| n.status != NodeStatus::External);
    let mut stats = Stats::default();
    for n in plan_nodes {
        stats.courses += 1;
        match n.status {
            NodeStatus::Approved => {
                stats.approved += 1;
                stats.approved_credits += n.credits as u32;
            }
            NodeStatus::Available => stats.available += 1,
            NodeStatus::Locked => stats.locked += 1,
            NodeStatus::External => {}
        }
    }
    Graph {
        nodes,
        edges,
        layers,
        stats,
    }
}

/// Layer = longest prerequisite chain ending at the node; order inside a layer
/// by a few barycenter sweeps to reduce crossings.
fn layout(nodes: &mut [Node], edges: &[Edge], index: &HashMap<String, usize>) -> u32 {
    let n = nodes.len();
    let mut preds: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut succs: Vec<Vec<usize>> = vec![Vec::new(); n];
    for e in edges {
        if let (Some(&a), Some(&b)) = (index.get(&e.from), index.get(&e.to)) {
            if !preds[b].contains(&a) {
                preds[b].push(a);
                succs[a].push(b);
            }
        }
    }

    // Longest path with cycle protection (the SIA occasionally lists mutual corequisites).
    let mut layer: Vec<Option<u32>> = vec![None; n];
    let mut on_stack = vec![false; n];
    fn depth(
        v: usize,
        preds: &[Vec<usize>],
        layer: &mut [Option<u32>],
        on_stack: &mut [bool],
    ) -> u32 {
        if let Some(l) = layer[v] {
            return l;
        }
        on_stack[v] = true;
        let mut best = 0;
        for &p in &preds[v] {
            if on_stack[p] {
                continue;
            }
            best = best.max(depth(p, preds, layer, on_stack) + 1);
        }
        on_stack[v] = false;
        layer[v] = Some(best);
        best
    }
    for v in 0..n {
        depth(v, &preds, &mut layer, &mut on_stack);
    }
    let layer: Vec<u32> = layer.into_iter().map(|l| l.unwrap_or(0)).collect();
    let layers = layer.iter().copied().max().map_or(0, |m| m + 1);

    let mut rows: Vec<Vec<usize>> = vec![Vec::new(); layers as usize];
    let mut ids: Vec<usize> = (0..n).collect();
    ids.sort_by(|a, b| nodes[*a].name.cmp(&nodes[*b].name));
    for v in ids {
        rows[layer[v] as usize].push(v);
    }
    let mut pos = vec![0f64; n];
    let refresh = |rows: &Vec<Vec<usize>>, pos: &mut Vec<f64>| {
        for r in rows {
            for (i, v) in r.iter().enumerate() {
                pos[*v] = i as f64;
            }
        }
    };
    refresh(&rows, &mut pos);
    for sweep in 0..6 {
        let down = sweep % 2 == 0;
        let order: Vec<usize> = if down {
            (1..rows.len()).collect()
        } else {
            (0..rows.len().saturating_sub(1)).rev().collect()
        };
        for r in order {
            let neigh = if down { &preds } else { &succs };
            let mut keyed: Vec<(f64, usize)> = rows[r]
                .iter()
                .map(|&v| {
                    let ns: Vec<f64> = neigh[v]
                        .iter()
                        .filter(|u| layer[**u] != layer[v])
                        .map(|u| pos[*u])
                        .collect();
                    let key = if ns.is_empty() {
                        pos[v]
                    } else {
                        ns.iter().sum::<f64>() / ns.len() as f64
                    };
                    (key, v)
                })
                .collect();
            keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
            rows[r] = keyed.into_iter().map(|(_, v)| v).collect();
            refresh(&rows, &mut pos);
        }
    }
    for r in &rows {
        for (i, v) in r.iter().enumerate() {
            nodes[*v].layer = layer[*v];
            nodes[*v].order = i as u32;
        }
    }
    layers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::PrereqRef;

    fn c(code: &str, prereqs: &[&str]) -> CoursePrereqs {
        CoursePrereqs {
            code: code.into(),
            name: format!("Curso {code}"),
            credits: 3,
            typology: Typology::FundObligatoria,
            conditions: if prereqs.is_empty() {
                vec![]
            } else {
                vec![Condition {
                    number: 1,
                    kind: "M".into(),
                    all: true,
                    required: None,
                    courses: prereqs
                        .iter()
                        .map(|p| PrereqRef {
                            code: (*p).into(),
                            name: format!("Curso {p}"),
                        })
                        .collect(),
                }]
            },
        }
    }

    #[test]
    fn statuses_and_layers() {
        let plan = vec![c("A", &[]), c("B", &["A"]), c("C", &["B"]), c("D", &["X"])];
        let g = build(&plan, &["A".into()], &Options::default());
        let get = |code: &str| g.nodes.iter().find(|n| n.code == code).unwrap();
        assert_eq!(get("A").status, NodeStatus::Approved);
        assert_eq!(get("B").status, NodeStatus::Available);
        assert_eq!(get("C").status, NodeStatus::Locked);
        assert_eq!(get("X").status, NodeStatus::External);
        assert_eq!((get("A").layer, get("B").layer, get("C").layer), (0, 1, 2));
        assert_eq!(get("A").unlocks, vec!["B".to_string()]);
        assert_eq!(g.stats.courses, 4);

        let hidden = build(
            &plan,
            &[],
            &Options {
                hide_external: true,
                ..Default::default()
            },
        );
        assert!(hidden.nodes.iter().all(|n| n.code != "X"));
    }

    #[test]
    fn survives_cycles() {
        let plan = vec![c("A", &["B"]), c("B", &["A"])];
        let g = build(&plan, &[], &Options::default());
        assert_eq!(g.nodes.len(), 2);
    }
}
