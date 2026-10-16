import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/misc";
import { modKey } from "@/lib/utils";

export type TourId = "welcome" | "planner" | "addCourses" | "generator" | "progress" | "curriculum";

export interface TourStep {
  /** Value of the `data-tour` attribute to spotlight; omitted = centered card. */
  target?: string;
  title: string;
  body: ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
}

export const TOURS: Record<TourId, TourStep[]> = {
  welcome: [
    {
      title: "Bienvenido a BetterCampus",
      body: (
        <>
          Todo corre en tu computador: la consulta al SIA, la generación de horarios y el análisis de tu historia. No necesitas cuenta
          para usarla.
        </>
      ),
    },
    {
      target: "nav",
      placement: "right",
      title: "Tus herramientas",
      body: "Planeador de horarios, tu avance académico y el mapa de prerrequisitos de tu carrera. Cada una tiene su propio recorrido la primera vez que la abres.",
    },
    {
      target: "palette",
      placement: "right",
      title: "Ve a cualquier parte rápido",
      body: (
        <>
          Abre la paleta de comandos con <Kbd>{modKey()}</Kbd> <Kbd>K</Kbd> para buscar materias, cambiar de vista o crear un horario.
        </>
      ),
    },
    {
      target: "settings",
      placement: "right",
      title: "Ajustes",
      body: "Tema, horas de la grilla, fechas del semestre y la opción de repetir estos tutoriales.",
    },
  ],
  planner: [
    {
      target: "library",
      placement: "right",
      title: "Tus asignaturas",
      body: "Aquí quedan las materias que traes del SIA o agregas a mano. Despliega una para ver sus grupos, cupos y profesores.",
    },
    {
      target: "add-courses",
      placement: "bottom",
      title: "Trae materias del SIA",
      body: "Elige tu carrera y las asignaturas que quieres ver. BetterCampus las consulta directamente en el SIA y las guarda para la próxima vez.",
    },
    {
      target: "grid",
      placement: "left",
      title: "Tu semana",
      body: "Al pasar el cursor por un grupo verás dónde caería. Si choca con otra materia, se marca en rojo antes de que lo agregues.",
    },
    {
      target: "schedule-tabs",
      placement: "bottom",
      title: "Varios horarios",
      body: "Crea alternativas (plan A, plan B…), renómbralas o duplícalas. Cada una se guarda sola.",
    },
    {
      target: "generate",
      placement: "bottom",
      title: "Deja que BetterCampus lo arme",
      body: "El generador prueba todas las combinaciones sin choques y las ordena según lo que prefieras: menos huecos, menos días o mañanas libres.",
    },
    {
      target: "export",
      placement: "bottom",
      title: "Llévalo a tu calendario",
      body: "Exporta a Google Calendar o a un archivo .ics para Outlook o Apple Calendar, con las fechas reales del semestre.",
    },
  ],
  addCourses: [
    {
      target: "career-picker",
      placement: "right",
      title: "Elige tu plan de estudios",
      body: "Nivel, sede, facultad y plan, tal como en el buscador del SIA. Puedes guardarlo como tu carrera por defecto.",
    },
    {
      target: "electives",
      placement: "right",
      title: "¿Buscas libre elección?",
      body: "Activa esta opción para ver la oferta de libre elección de tu sede en lugar de las materias del plan.",
    },
    {
      target: "catalog",
      placement: "left",
      title: "Selecciona y agrega",
      body: "Filtra por nombre o tipología y marca las que quieras. Al agregarlas, verás el progreso de la consulta materia por materia.",
    },
  ],
  generator: [
    {
      target: "gen-courses",
      placement: "left",
      title: "¿Qué materias quieres ver?",
      body: "Marca las asignaturas a combinar. Si no caben todas, el generador te muestra las combinaciones con la mayor cantidad posible.",
    },
    {
      target: "gen-constraints",
      placement: "left",
      title: "Tus restricciones",
      body: "Días disponibles, franja horaria, tope de créditos y solo grupos con cupos. Tus bloques personales (trabajo, transporte) también se respetan.",
    },
    {
      target: "gen-preferences",
      placement: "left",
      title: "Qué es un buen horario para ti",
      body: "Ajusta cuánto pesan los huecos, los días en el campus y la jornada. Los grupos marcados con corazón suman puntos.",
    },
    {
      target: "gen-run",
      placement: "top",
      title: "Genera y compara",
      body: "Pasa el cursor por un resultado para verlo en la grilla. Aplícalo al horario actual o guárdalo como uno nuevo.",
    },
  ],
  progress: [
    {
      target: "history-input",
      placement: "bottom",
      title: "Pega tu historia académica",
      body: "En el SIA abre «Mi historia académica», selecciona todo (Ctrl+A), cópialo y pégalo aquí. Se procesa en tu equipo, no se envía a ningún servidor.",
    },
  ],
  curriculum: [
    {
      target: "plan-picker",
      placement: "bottom",
      title: "Descarga tu plan",
      body: "BetterCampus consulta en el SIA los prerrequisitos de cada materia del plan (tarda menos de un minuto) y los guarda.",
    },
    {
      target: "graph",
      placement: "top",
      title: "El mapa de tu carrera",
      body: "Cada columna es un nivel de la cadena de prerrequisitos. Pasa el cursor por una materia para resaltar lo que necesita y lo que habilita. Arrastra para moverte y usa la rueda para acercar.",
    },
    {
      target: "graph-filters",
      placement: "bottom",
      title: "Con tu historia",
      body: "Si cargaste tu historia académica, se marcan las materias aprobadas y las que ya puedes inscribir.",
    },
  ],
};
