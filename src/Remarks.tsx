// Stage 3.5: remarks with a status — open → fixed (student, maybe with a reply) → closed or reopened (supervisor).
import { useState } from "react";
import type { Note } from "./model";

export const STATUS_LABEL = { open: "відкрито", fixed: "виправлено", closed: "закрито" } as const;
export type RemarkPatch = Partial<Pick<Note, "status" | "reply">>;

/** Status, reply and the actions that fit: the author closes or reopens; the other side marks it fixed. */
export function Remark(props: { n: Note; me: string; who: (by: string) => string; set: (p: RemarkPatch) => void }) {
  const { n } = props;
  const [answer, setAnswer] = useState<string | null>(null);
  if (!n.status) return null;
  const author = n.by === props.me;
  return (
    <span className="remark">
      <span className={"rchip " + n.status}>{STATUS_LABEL[n.status]}</span>
      {n.reply?.text && <span className="small rreply">↳ {props.who(n.reply.by)}: {n.reply.text}</span>}
      {answer !== null ? (
        <span className="stack" style={{ gap: 4 }}>
          <textarea className="input mono" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Що змінено (необов'язково)" aria-label="Відповідь на зауваження" />
          <span className="row" style={{ gap: 8 }}>
            <button className="btn sm primary" onClick={() => { props.set({ status: "fixed", reply: answer.trim() ? { text: answer.trim(), by: props.me, at: Date.now() } : undefined }); setAnswer(null); }}>Позначити виправленим</button>
            <button className="link" style={{ fontSize: 12 }} onClick={() => setAnswer(null)}>Скасувати</button>
          </span>
        </span>
      ) : (
        <span className="row" style={{ gap: 10 }}>
          {!author && n.status === "open" && <button className="link" style={{ fontSize: 12 }} onClick={() => setAnswer("")}>Виправлено…</button>}
          {!author && n.status === "fixed" && <button className="link" style={{ fontSize: 12 }} onClick={() => props.set({ status: "open", reply: undefined })}>Повернути у відкриті</button>}
          {author && n.status === "fixed" && <button className="link" style={{ fontSize: 12 }} onClick={() => props.set({ status: "closed" })}>Закрити</button>}
          {author && n.status !== "open" && <button className="link" style={{ fontSize: 12 }} onClick={() => props.set({ status: "open" })}>Відкрити знову</button>}
        </span>
      )}
    </span>
  );
}

export type RemarkRow = { key: string; n: Note; where: string; go?: () => void };

/** All remarks of the project in one list, with the filter «Відкриті й виправлені / Усі». */
export function RemarksView(props: { rows: RemarkRow[]; me: string; who: (by: string) => string; set: (key: string, p: RemarkPatch) => void; onBack: () => void }) {
  const [all, setAll] = useState(false);
  const rows = props.rows.filter((r) => all || r.n.status !== "closed").sort((a, b) => b.n.at - a.n.at);
  return (
    <section className="stack" style={{ gap: 14, maxWidth: 920 }} aria-label="Зауваження">
      <div className="row">
        <span className="title grow">Зауваження</span>
        <div className="seg" role="group" aria-label="Які зауваження показувати">
          <button aria-pressed={!all} onClick={() => setAll(false)}>Відкриті й виправлені</button>
          <button aria-pressed={all} onClick={() => setAll(true)}>Усі</button>
        </div>
        <button className="btn sm" onClick={props.onBack}>← До транскрипту</button>
      </div>
      <span className="small">Шлях зауваження: <b>відкрито</b> → студент(ка) позначає <b>«виправлено»</b> (можна з відповіддю) → супервайзер(ка) <b>закриває</b> або <b>відкриває знову</b>. Зауваження й статуси ходять тими самими пакетами в обидва боки.</span>
      {rows.map((r) => (
        <div className="frag" key={r.key}>
          <div className="stack" style={{ gap: 3, flex: "0 0 170px" }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{r.where}</span>
            <span className="small">{props.who(r.n.by)} · {new Date(r.n.at).toLocaleDateString("uk-UA")}</span>
          </div>
          <div className="stack grow" style={{ gap: 6, minWidth: 0 }}>
            <p className="mono" style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>{r.n.text}</p>
            <Remark n={r.n} me={props.me} who={props.who} set={(p) => props.set(r.key, p)} />
          </div>
          {r.go && <button className="btn sm quiet" style={{ alignSelf: "flex-start" }} onClick={r.go}>У контексті →</button>}
        </div>
      ))}
      {!rows.length && <span className="small">{all ? "Зауважень немає." : "Відкритих і виправлених зауважень немає."}</span>}
    </section>
  );
}
