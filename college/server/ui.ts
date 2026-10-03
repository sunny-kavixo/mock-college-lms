export const DESIGN_SYSTEM_CSS = `
:root {
  --ink: #172033;
  --ink-soft: #526079;
  --navy: #142642;
  --blue: #2563eb;
  --blue-dark: #1d4ed8;
  --green: #15803d;
  --green-soft: #dcfce7;
  --red: #b42318;
  --red-soft: #fff1f0;
  --amber: #a15c00;
  --amber-soft: #fff7df;
  --line: #dbe4f0;
  --surface: #ffffff;
  --canvas: #f4f7fb;
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --shadow-sm: 0 4px 14px rgba(20, 38, 66, .06);
  --shadow-md: 0 16px 40px rgba(20, 38, 66, .10);
}

html { min-width: 320px; }
body {
  background: var(--canvas);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
}
a { color: var(--blue-dark); }
button, input { font: inherit; }
button:focus-visible, a:focus-visible, input:focus-visible {
  outline: 3px solid rgba(37, 99, 235, .28);
  outline-offset: 3px;
}
.site-header {
  background: var(--navy);
  border-bottom: 1px solid rgba(255, 255, 255, .10);
  color: white;
}
.header-inner {
  max-width: 1180px;
  min-height: 76px;
  margin: 0 auto;
  padding: 0 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.brand {
  color: white;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  font-size: 18px;
  letter-spacing: -.02em;
}
.brand-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: linear-gradient(135deg, #60a5fa, #14b8a6);
  color: var(--navy);
  font-weight: 900;
}
.header-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #c7d4e8;
  font-size: 13px;
}
.env-badge, .student-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.env-badge { background: rgba(45, 212, 191, .16); color: #99f6e4; }
.student-chip { background: #eef4ff; color: #24436e; letter-spacing: 0; text-transform: none; }
main.page-shell {
  max-width: 1180px;
  margin: 0 auto;
  padding: 44px 28px 72px;
}
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 10px; font-size: clamp(28px, 4vw, 42px); letter-spacing: -.045em; line-height: 1.1; }
h2 { margin-bottom: 8px; letter-spacing: -.025em; }
.eyebrow {
  margin-bottom: 10px;
  color: var(--blue-dark);
  font-size: 12px;
  font-weight: 850;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.muted { color: var(--ink-soft); }
.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 30px;
}
.heading-actions, .button-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}
.card + .card { margin-top: 18px; }
.course-grid, .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 18px;
}
.course-card { position: relative; overflow: hidden; }
.course-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 4px;
  background: linear-gradient(90deg, #2563eb, #14b8a6);
}
.course-card-header, .section-heading, .metric-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.course-card-header { margin-bottom: 22px; }
.course-card-header h2 { max-width: 18rem; }
.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
.status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.locked { background: var(--red-soft); color: var(--red); }
.open { background: var(--green-soft); color: var(--green); }
.submitted { background: #e7efff; color: #2452a5; }
.metric-label { color: var(--ink-soft); font-size: 13px; }
.metric-value { font-weight: 800; }
.progress-track {
  height: 10px;
  margin: 10px 0 8px;
  overflow: hidden;
  background: #e9eff7;
  border-radius: 999px;
}
.progress-bar {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--blue), #14b8a6);
  border-radius: inherit;
  transition: width .25s linear;
}
.progress-caption { display: flex; justify-content: space-between; color: var(--ink-soft); font-size: 12px; }
.course-next {
  min-height: 42px;
  margin: 20px 0;
  padding: 11px 13px;
  border-radius: var(--radius-sm);
  background: #f7f9fc;
  color: var(--ink-soft);
  font-size: 13px;
}
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 10px 15px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--blue-dark);
  color: white;
  cursor: pointer;
  text-decoration: none;
  font-weight: 750;
  transition: background .15s ease, transform .15s ease, box-shadow .15s ease;
}
.button:hover { background: #173da9; box-shadow: 0 6px 16px rgba(29, 78, 216, .20); transform: translateY(-1px); }
.button.secondary { background: white; border-color: var(--line); color: #24436e; }
.button.secondary:hover { background: #f7f9fc; }
.button.ghost { min-height: 38px; padding: 8px 12px; background: transparent; color: #d9e5f5; border-color: rgba(255,255,255,.22); }
.button.ghost:hover { background: rgba(255,255,255,.10); box-shadow: none; }
button:disabled, .disabled { opacity: .45; cursor: not-allowed; transform: none; }
input { width: 100%; padding: 12px 13px; border: 1px solid #cbd7e6; border-radius: var(--radius-sm); background: white; color: var(--ink); }
input[type="radio"] { width: auto; accent-color: var(--blue); }
label { display: block; margin-bottom: 8px; font-weight: 700; }
.recording-shell { overflow: hidden; padding: 0; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); }
.recording {
  min-height: 285px;
  display: grid;
  place-items: center;
  padding: 42px;
  background: radial-gradient(circle at 20% 10%, #294d7d, transparent 44%), linear-gradient(135deg, #0c1b31, #142642);
  color: white;
  text-align: center;
}
.recording-icon { width: 68px; height: 68px; display: grid; place-items: center; margin: 0 auto 18px; border-radius: 22px; background: rgba(96,165,250,.18); color: #93c5fd; font-size: 28px; }
.recording-controls { padding: 26px; background: white; }
.recording-status { color: var(--ink-soft); font-size: 13px; }
.gate-note { display: flex; gap: 10px; margin-top: 18px; padding: 13px 14px; border-radius: var(--radius-sm); background: var(--amber-soft); color: var(--amber); font-size: 13px; }
.notice { padding: 15px 16px; border-radius: var(--radius-sm); background: #eef4ff; color: #24436e; }
.notice.error { background: var(--red-soft); color: var(--red); }
.assignment-form { max-width: 780px; margin: 0 auto; }
.question-card { box-shadow: none; }
.question-card p { font-size: 16px; font-weight: 700; }
.option { display: flex; align-items: flex-start; gap: 10px; margin: 13px 0; font-weight: 500; }
.option input { margin-top: 4px; }
.auth-card { max-width: 470px; margin: 42px auto; padding: 34px; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); }
.auth-mark { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 22px; border-radius: 16px; background: #e7efff; color: var(--blue-dark); font-size: 22px; font-weight: 900; }
.auth-card .button { width: 100%; margin-top: 8px; }
.status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 18px; }
.status-metric { padding: 18px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fbfcfe; }
.status-metric strong { display: block; margin-top: 5px; font-size: 18px; }
.status-table { width: 100%; border-collapse: collapse; }
.status-table th, .status-table td { padding: 13px 10px; border-bottom: 1px solid var(--line); text-align: left; font-size: 13px; vertical-align: top; }
.status-table th { color: var(--ink-soft); font-weight: 750; }
.empty-state { padding: 34px; text-align: center; color: var(--ink-soft); }
@media (max-width: 700px) {
  .header-inner, main.page-shell { padding-left: 18px; padding-right: 18px; }
  .header-inner { min-height: 68px; }
  .header-meta .header-kicker, .student-chip { display: none; }
  main.page-shell { padding-top: 28px; }
  .page-heading { align-items: flex-start; flex-direction: column; }
  .heading-actions { width: 100%; }
  .heading-actions .button, .heading-actions form { flex: 1; }
  .heading-actions .button, .heading-actions button { width: 100%; }
  .course-grid, .grid { grid-template-columns: 1fr; }
  .recording { min-height: 240px; padding: 28px 18px; }
  .recording-controls { padding: 20px; }
  .status-table { display: block; overflow-x: auto; white-space: nowrap; }
}
`;
