import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Github, Heart, Instagram, ShieldCheck } from "lucide-react";
import logo from "@/assets/logo.png";
import camilo from "@/assets/team/CatCamilo.webp";
import juanO from "@/assets/team/JuanOrozco3.webp";
import carlos from "@/assets/team/CarlosSandoval1.webp";
import omar from "@/assets/team/OmarToledo1.webp";
import juanP from "@/assets/team/JuanPalacios.webp";
import reinaldo from "@/assets/team/ReinaldoToledo.webp";
import samuel from "@/assets/team/SamuelGomez1.webp";
import { api } from "@/lib/api";

const TEAM = [
  { name: "Camilo Cuello", role: "Cofundador · Fullstack", photo: camilo, github: "https://github.com/Camilo-neck" },
  { name: "Juan Orozco", role: "Cofundador · Fullstack", photo: juanO, github: "https://github.com/jorozcove" },
  { name: "Carlos Sandoval", role: "Backend", photo: carlos, github: "https://github.com/CarlosSandoval-03" },
  { name: "Omar Toledo", role: "Backend", photo: omar, github: "https://github.com/omardtl24" },
  { name: "Juan Palacios", role: "Frontend", photo: juanP, github: "https://github.com/juandp1" },
  { name: "Reinaldo Toledo", role: "Frontend", photo: reinaldo, github: "https://github.com/Rey7910" },
  { name: "Samuel Gómez", role: "Research", photo: samuel, github: "https://github.com/SamuelGomezG" },
];

const LINKS = [
  { label: "bettercampus.com.co", url: "https://bettercampus.com.co" },
  { label: "Instagram", url: "https://www.instagram.com/better_campus/", icon: Instagram },
];

export function AboutPage() {
  const info = useQuery({ queryKey: ["appInfo"], queryFn: api.appInfo, staleTime: Infinity });
  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-10">
        <div className="flex items-center gap-5">
          <img src={logo} alt="" className="size-20" draggable={false} />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Better<span className="text-primary">Campus</span>
            </h1>
            <p className="mt-1 text-sm text-on-surface-variant">Versión {info.data?.version ?? "—"} para escritorio</p>
            <div className="mt-2 flex gap-3">
              {LINKS.map((l) => (
                <button key={l.url} onClick={() => openUrl(l.url)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  {l.icon ? <l.icon className="size-3.5" /> : <ExternalLink className="size-3.5" />} {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[15px] leading-relaxed text-on-surface-variant">
          BetterCampus nació en 2021 para que planear el semestre en la Universidad Nacional no dependa de abrir diez pestañas del SIA. Esta versión de
          escritorio hace todo en tu equipo: consulta la oferta, combina horarios sin choques, analiza tu historia académica y dibuja el mapa de tu carrera.
        </p>

        <div className="card flex items-start gap-3 p-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="text-sm">
            <div className="font-semibold">Tus datos se quedan contigo</div>
            <p className="mt-1 text-on-surface-variant">
              No hay cuenta ni servidor intermedio. Tu historia académica, tus horarios y tus favoritos viven en una base de datos local. Solo se contacta al
              SIA, a LosEstudiantes para reseñas de profesores, a la API pública de cupos de BetterCampus y, si lo conectas, a Google Calendar.
            </p>
          </div>
        </div>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">El equipo</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TEAM.map((m) => (
              <button key={m.name} onClick={() => openUrl(m.github)} className="card group flex items-center gap-3 p-3 text-left transition hover:border-primary/40">
                <img src={m.photo} alt="" className="size-11 rounded-full object-cover" draggable={false} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{m.name}</div>
                  <div className="truncate text-xs text-on-surface-variant">{m.role}</div>
                </div>
                <Github className="size-4 text-on-surface-variant opacity-0 transition group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </section>

        <section className="text-xs leading-relaxed text-on-surface-variant">
          <h2 className="mb-2 text-[13px] font-semibold text-on-surface">Avisos</h2>
          <p>
            BetterCampus es un proyecto estudiantil independiente; no está afiliado a la Universidad Nacional de Colombia. La información de asignaturas,
            grupos y cupos proviene del buscador público del SIA y puede cambiar en cualquier momento: verifica siempre en el SIA antes de inscribir.
          </p>
          <p className="mt-2">
            Construido con Tauri, React y Rust. Las reseñas de profesores provienen de LosEstudiantes.
          </p>
          <p className="mt-3 flex items-center gap-1">
            Hecho con <Heart className="size-3 fill-error text-error" /> por estudiantes de la UNAL.
          </p>
        </section>
      </div>
    </div>
  );
}
