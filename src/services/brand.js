// Marca de CitaDental AI (la misma que citadentalai.site): paleta, tipografías,
// logo y mascota. Lo usan todas las pantallas del dashboard para que se vean
// como la web.
//   #1F4EA8 deep · #3E73D1 mid · #6FAEF5 light · #F4F6F8 surface
//   #17324D texto · #5B6B7A texto suave · WhatsApp verde · naranja de alerta

const MASCOT_URL = '/brand/mascota.png';

const HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1F4EA8"/><stop offset="1" stop-color="#6FAEF5"/></linearGradient></defs><path d="M20 5c-4 0-6 1.5-9 1.5S6 5 6 11c0 5 2 8 3 13s2 11 5 11c2.5 0 2.5-7 6-7s3.5 7 6 7c3 0 4-6 5-11s3-8 3-13c0-6-2-4.5-5-4.5S24 5 20 5Z" fill="url(#g)"/><circle cx="26" cy="14" r="1.6" fill="#fff" opacity=".9"/></svg>'
)}">`;

// Logo de la web: diente con degradado + "CitaDental AI".
function logo(subtitle = '') {
  return `<span class="logo"><svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="toothGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="var(--brand-deep)"/><stop offset="100%" stop-color="var(--brand-light)"/></linearGradient></defs><path d="M20 5c-4 0-6 1.5-9 1.5S6 5 6 11c0 5 2 8 3 13s2 11 5 11c2.5 0 2.5-7 6-7s3.5 7 6 7c3 0 4-6 5-11s3-8 3-13c0-6-2-4.5-5-4.5S24 5 20 5Z" fill="url(#toothGrad)"/><circle cx="26" cy="14" r="1.6" fill="white" opacity="0.9"/></svg><span class="wordmark">CitaDental <b>AI</b></span>${
    subtitle ? `<span class="logo-sub">${subtitle}</span>` : ''
  }</span>`;
}

// Mascota con un bocadillo (estados vacíos, bienvenida...).
function mascot(text, { size = 110, float = true } = {}) {
  return `<div class="mascot-box"><img src="${MASCOT_URL}" alt="" width="${size}" class="${float ? 'float' : ''}" style="width:${size}px">${
    text ? `<div class="bubble">${text}</div>` : ''
  }</div>`;
}

const CSS = `
:root{--brand-deep:#1F4EA8;--brand-mid:#3E73D1;--brand-light:#6FAEF5;--brand-soft:#EEF4FD;--surface:#F4F6F8;
--text-strong:#17324D;--text-muted:#5B6B7A;--border:#E3E8EF;--whatsapp:#25A55F;--alert:#E8742A;--alert-soft:#FDF1E7;
--radius:16px;--shadow-soft:0 1px 2px rgba(31,78,168,.06),0 12px 32px -12px rgba(31,78,168,.18);--shadow-glow:0 20px 60px -20px rgba(62,115,209,.45)}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,sans-serif;background:var(--surface);color:var(--text-strong);line-height:1.5;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:var(--text-strong);letter-spacing:-.02em}
a{color:var(--brand-mid)}
.topbar{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);border-bottom:1px solid rgba(0,0,0,.05);
 padding:0 24px;height:64px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.topbar nav{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.topbar nav a{color:var(--text-muted);text-decoration:none;font-size:14px;font-weight:500;padding:7px 12px;border-radius:999px}
.topbar nav a:hover{color:var(--brand-deep);background:var(--brand-soft)} .topbar nav a.on{color:var(--brand-deep);font-weight:600}
.topbar .who{font-size:13px;color:var(--text-muted);margin-right:6px}
@media (max-width:720px){.topbar{height:auto;padding:10px 16px;flex-wrap:wrap}.topbar .who{display:none}}
.logo{display:inline-flex;align-items:center;gap:10px;text-decoration:none}
.logo svg{width:34px;height:34px;flex:none}
.wordmark{font-family:"Plus Jakarta Sans",system-ui,sans-serif;font-size:18px;font-weight:700;letter-spacing:-.02em;color:var(--text-strong);white-space:nowrap}
.wordmark b{color:var(--brand-mid);font-weight:600}
.logo-sub{font-size:13px;font-weight:600;color:var(--text-muted);padding-left:10px;margin-left:2px;border-left:1px solid var(--border);white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--brand-deep);color:#fff;border:0;border-radius:999px;padding:10px 20px;
 font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;box-shadow:var(--shadow-soft);transition:background .15s}
.btn:hover{background:var(--brand-mid)}
.btn.sec{background:#fff;color:var(--brand-deep);border:1px solid var(--border);box-shadow:none} .btn.sec:hover{background:var(--brand-soft)}
.btn.green{background:var(--whatsapp)} .btn.green:hover{background:#1f8f52}
.btn.red{background:#DC2F2F} .btn.red:hover{background:#b92525}
.btn[disabled]{opacity:.6;cursor:wait}
.ok{background:#EAF7EF;color:#17633A;border:1px solid #BFE6CE;padding:11px 16px;border-radius:12px;margin-bottom:16px}
.err{background:#FDECEC;color:#8E1F1F;border:1px solid #F6C9C9;padding:11px 16px;border-radius:12px;margin-bottom:16px}
.info{background:var(--brand-soft);color:var(--brand-deep);border:1px solid #D3E2FA;padding:11px 16px;border-radius:12px;margin-bottom:16px}
.warn{background:var(--alert-soft);color:#8A4210;border:1px solid #F6D3B8;padding:11px 16px;border-radius:12px;margin-bottom:16px}
.mascot-box{display:flex;align-items:center;gap:14px;justify-content:center}
.mascot-box img{height:auto;filter:drop-shadow(0 14px 24px rgba(31,78,168,.25))}
.mascot-box .bubble{position:relative;background:#fff;border:1px solid var(--border);border-radius:18px;padding:12px 16px;max-width:360px;
 font-size:15px;color:var(--text-strong);box-shadow:var(--shadow-soft);text-align:left}
.mascot-box .bubble:before{content:"";position:absolute;left:-8px;top:50%;width:14px;height:14px;background:#fff;border-left:1px solid var(--border);
 border-bottom:1px solid var(--border);transform:translateY(-50%) rotate(45deg)}
/* Fondo "hero" de la web: degradado suave, dos halos azules y rejilla tenue */
body{background:linear-gradient(180deg,rgba(238,244,253,.85) 0,#fff 420px,var(--surface) 100%);min-height:100vh;position:relative}
body:before,body:after{content:"";position:fixed;z-index:-1;border-radius:50%;filter:blur(70px);pointer-events:none}
body:before{top:-160px;right:-120px;width:480px;height:480px;background:rgba(111,174,245,.30)}
body:after{bottom:-160px;left:-120px;width:420px;height:420px;background:rgba(62,115,209,.13)}
.grid-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.035;
 background-image:linear-gradient(var(--brand-deep) 1px,transparent 1px),linear-gradient(90deg,var(--brand-deep) 1px,transparent 1px);background-size:44px 44px}
.text-gradient{background:linear-gradient(135deg,var(--brand-deep),var(--brand-mid) 60%,var(--brand-light));-webkit-background-clip:text;background-clip:text;color:transparent}
.eyebrow{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(31,78,168,.12);background:rgba(255,255,255,.7);border-radius:999px;
 padding:5px 12px;font-size:12px;font-weight:600;color:var(--brand-deep);backdrop-filter:blur(6px)}
.eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--brand-mid);box-shadow:0 0 0 0 rgba(62,115,209,.6);animation:ping 1.6s infinite}
.eyebrow.live i{background:var(--whatsapp);box-shadow:0 0 0 0 rgba(37,165,95,.6)}
@keyframes ping{0%{box-shadow:0 0 0 0 rgba(62,115,209,.55)}80%,100%{box-shadow:0 0 0 7px rgba(62,115,209,0)}}
.btn{transition:background .15s,transform .15s,box-shadow .15s} .btn:not(.sec):hover{transform:translateY(-1px);box-shadow:var(--shadow-glow)}
.site-foot{text-align:center;color:var(--text-muted);font-size:13px;padding:28px 16px 36px}
.site-foot a{color:var(--text-muted);text-decoration:none;font-weight:600} .site-foot a:hover{color:var(--brand-deep)}
@keyframes float-slow{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.float{animation:float-slow 6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.float{animation:none}}
`;

// Va justo después de <body>: rejilla de fondo de la web.
const BG = '<div class="grid-bg" aria-hidden="true"></div>';
const FOOTER = `<footer class="site-foot">${'<a href="https://www.citadentalai.site" target="_blank" rel="noopener">CitaDental AI</a>'} · Recepcionista con IA para clínicas dentales</footer>`;

module.exports = { HEAD, CSS, BG, FOOTER, logo, mascot, MASCOT_URL };
