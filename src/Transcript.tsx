import { applyDict, wordKey, type Segment } from "./text";
import { speaker, type Interview, type Private } from "./model";

// ---------- transcript ----------

const CAP = /(\p{Lu}[\p{Ll}'’ʼ-]*\p{Ll}|\p{Lu}{2,6})/u;

function Plain(props: { text: string; flagged: Set<string> }) {
  if (!props.flagged.size) return <>{props.text}</>;
  return (
    <>
      {props.text.split(new RegExp(CAP.source, "gu")).map((part, i) =>
        i % 2 === 1 && props.flagged.has(wordKey(part)) ? <mark key={i} className="suspect" title="Схоже на ім'я чи назву місця, ще не замінено">{part}</mark> : part,
      )}
    </>
  );
}

export function Transcript(props: { iv: Interview; priv: Private; original: boolean; flagged: Set<string> }) {
  const { iv, priv, original, flagged } = props;
  const reps = priv.originals[iv.id] ?? [];
  return (
    <div className="sheet">
      {reps.map((r, i) => {
        const segs: Segment[] = applyDict(r.text, priv.dict, iv.id);
        return (
          <div className="rep" key={i}>
            <span className="tc">{r.t ?? ""}</span>
            <span className="who">{speaker(r.role, iv.card)}</span>
            <span className="say">
              {segs.map((s, j) =>
                s.orig === undefined ? <Plain key={j} text={s.text} flagged={flagged} />
                  : original ? <mark key={j} className="orig" title={`Колеги бачать: ${s.text}`}>{s.orig}</mark>
                  : <mark key={j} className="repl" title="Замінено за словником">{s.text}</mark>,
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

