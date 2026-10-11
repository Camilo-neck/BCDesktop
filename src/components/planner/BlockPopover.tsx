import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger, Select, Tooltip } from "@/components/ui/primitives";
import { DAYS, type Block } from "@/lib/types";
import { DAY_LONG, hhmm, parseHHMM } from "@/lib/utils";

/** Form to add a personal block (work, commute) the generator must keep free. */
export function BlockForm({ initial, onSubmit, onDelete }: { initial?: Block; onSubmit: (b: Block) => void; onDelete?: () => void }) {
  const [b, setB] = useState<Block>(initial ?? { day: "MON", start: 12 * 60, end: 14 * 60, label: "" });
  const valid = b.end > b.start;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Nombre</Label>
        <Input value={b.label} onChange={(e) => setB({ ...b, label: e.target.value })} placeholder="Trabajo, transporte, almuerzo…" autoFocus />
      </div>
      <div>
        <Label>Día</Label>
        <Select value={b.day} onValueChange={(v) => setB({ ...b, day: v as Block["day"] })} options={DAYS.map((d) => ({ value: d, label: DAY_LONG[d] }))} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Desde</Label>
          <Input type="time" value={hhmm(b.start)} onChange={(e) => setB({ ...b, start: parseHHMM(e.target.value) ?? b.start })} />
        </div>
        <div>
          <Label>Hasta</Label>
          <Input type="time" value={hhmm(b.end)} onChange={(e) => setB({ ...b, end: parseHHMM(e.target.value) ?? b.end })} />
        </div>
      </div>
      <div className="flex gap-2">
        {onDelete && (
          <Button variant="ghost" className="text-error" onClick={onDelete}>
            Eliminar
          </Button>
        )}
        <Button className="ml-auto" disabled={!valid} onClick={() => onSubmit(b)}>
          {initial ? "Guardar" : "Agregar bloque"}
        </Button>
      </div>
    </div>
  );
}

export function AddBlockButton({ onAdd }: { onAdd: (b: Block) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Bloque personal: horas que quieres libres">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            <Lock /> Bloque
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <BlockForm
          onSubmit={(b) => {
            onAdd(b);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
