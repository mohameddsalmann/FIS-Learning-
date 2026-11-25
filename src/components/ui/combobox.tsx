"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

interface Choice { value: string; label: string; detail?: string; }

export function Combobox({ label, value, options, onChange, noOptions = "No matches.", disabled }: {
  label: string; value: string; options: readonly Choice[]; onChange: (value: string) => void; noOptions?: string; disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const selected = options.find((option)=>option.value === value);
  const matches = options.filter((option)=>[option.label,option.detail,option.value].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  function close() { setOpen(false); setQuery(""); setActive(-1); }
  function choose(choice?: Choice) { if (choice) onChange(choice.value); close(); }
  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      const next = event.key === "ArrowDown" ? Math.min(active+1,matches.length-1) : active<0 ? matches.length-1 : Math.max(active-1,0);
      setActive(next);
      requestAnimationFrame(()=>document.getElementById(id+"-option-"+next)?.scrollIntoView({ block:"nearest" }));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open) choose(matches[active]);
      else setOpen(true);
    }
    else if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }
  return <div className="field picker">
    <label htmlFor={id}>{label}</label>
    <div className="picker-anchor">
      <input ref={input} id={id} role="combobox" autoComplete="off" spellCheck={false} disabled={disabled}
        aria-expanded={open} aria-autocomplete="list" aria-controls={id+"-choices"} aria-activedescendant={open && active >= 0 ? id+"-option-"+active : undefined}
        value={open ? query : selected?.label || ""} placeholder={selected?.label || label}
        onClick={()=>setOpen(true)} onChange={(event)=>{ setOpen(true); setQuery(event.target.value); setActive(-1); }}
        onBlur={close} onKeyDown={keydown} />
      <button type="button" className="picker-trigger" tabIndex={-1} aria-label={label} disabled={disabled}
        onPointerDown={(event)=>event.preventDefault()} onClick={()=>{ if(open) close(); else { input.current?.focus(); setOpen(true); } }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div id={id+"-choices"} className="picker-popup" role="listbox" aria-label={label} hidden={!open}>
        {matches.map((option,index)=><div role="option" id={id+"-option-"+index} aria-selected={option.value===value}
          className={index===active ? "picker-option active" : "picker-option"} key={option.value}
          onMouseDown={(event)=>event.preventDefault()} onClick={()=>choose(option)}>
          {option.label}{option.detail && <small>{option.detail}</small>}
        </div>)}
        {!matches.length && <p className="muted picker-option">{noOptions}</p>}
      </div>
    </div>
  </div>;
}
