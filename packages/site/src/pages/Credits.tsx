import { OSS, TEAM } from "../content.ts";

export function Credits() {
  return (
    <div className="credits">
      <section className="intro intro--credits">
        <span className="eyebrow">credits · ShellHacks 2026</span>
        <h1 className="intro__title">Built in 36 hours by three people.</h1>
      </section>

      <section className="team">
        {TEAM.map((m) => (
          <div key={m.handle} className="panel">
            <div className="card__tab">
              <span>{m.handle}</span>
              <span>{m.n}</span>
            </div>
            <div className="team__photo">
              <img
                src={m.photo}
                alt={m.name}
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
              photo
            </div>
            <div className="team__who">
              <span className="team__name">{m.name}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel__tab">standing on</div>
        <div className="cells">
          {OSS.map((o) => (
            <div key={o.n} className="cell">
              <div className="cell__big">{o.n}</div>
              <div className="cell__k">{o.d}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
