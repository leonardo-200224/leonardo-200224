// Genera las tarjetas vivas del perfil: el banner (Volt cambia según la hora de
// Colombia) y las estadísticas reales de GitHub. Lo corre GitHub Actions cada hora.
//   node scripts/generar.mjs <carpeta-de-salida>
// Con GITHUB_TOKEN usa la API GraphQL; sin token, lee el calendario público.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const USUARIO = process.env.USUARIO || 'leonardo-200224';
const TOKEN = process.env.GITHUB_TOKEN || '';
const SALIDA = process.argv[2] || 'salida';
mkdirSync(SALIDA, {recursive: true});

const SANS = `'Segoe UI',-apple-system,'Helvetica Neue',Ubuntu,Arial,sans-serif`;
const MONO = `Consolas,'SF Mono','Cascadia Code',Menlo,monospace`;
const C = {bg: '#0B0F17', fondo: '#05060A', borde: '#1E2636', texto: '#ECEFF6', suave: '#9BA4B7', tenue: '#5F6A82', azul: '#4D7CFF', cian: '#3FD0FF', senal: '#F5C542'};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ datos
async function api(ruta){
  const r = await fetch(`https://api.github.com${ruta}`, {headers: {
    'User-Agent': USUARIO, Accept: 'application/vnd.github+json', ...(TOKEN && {Authorization: `Bearer ${TOKEN}`})
  }});
  if(!r.ok) throw new Error(`${ruta}: ${r.status}`);
  return r.json();
}

async function calendario(){
  if(TOKEN){
    const q = `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;
    const r = await fetch('https://api.github.com/graphql', {method: 'POST',
      headers: {Authorization: `Bearer ${TOKEN}`, 'User-Agent': USUARIO, 'Content-Type': 'application/json'},
      body: JSON.stringify({query: q, variables: {l: USUARIO}})});
    const d = await r.json();
    const cal = d.data.user.contributionsCollection.contributionCalendar;
    return {total: cal.totalContributions, dias: cal.weeks.flatMap(w => w.contributionDays).map(x => ({fecha: x.date, n: x.contributionCount}))};
  }
  // Sin token: el calendario público del perfil.
  const html = await (await fetch(`https://github.com/users/${USUARIO}/contributions`)).text();
  const fechas = {};
  for(const m of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="([^"]+)"/g)) fechas[m[2]] = m[1];
  for(const m of html.matchAll(/id="([^"]+)"[^>]*data-date="(\d{4}-\d{2}-\d{2})"/g)) fechas[m[1]] = m[2];
  const dias = [];
  for(const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)){
    if(!fechas[m[1]]) continue;
    const n = /^(\d+)/.exec(m[2].trim());
    dias.push({fecha: fechas[m[1]], n: n ? +n[1] : 0});
  }
  dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return {total: dias.reduce((s, d) => s + d.n, 0), dias};
}

function rachas(dias){
  let larga = 0, actual = 0, corrida = 0;
  dias.forEach(d => { corrida = d.n > 0 ? corrida + 1 : 0; larga = Math.max(larga, corrida); });
  // La racha actual cuenta desde hoy o desde ayer (hoy puede no tener actividad todavía).
  const copia = [...dias];
  if(copia.length && copia[copia.length - 1].n === 0) copia.pop();
  for(let i = copia.length - 1; i >= 0 && copia[i].n > 0; i--) actual++;
  return {actual, larga};
}

const COLOR_LENGUAJE = {
  JavaScript: '#F1E05A', TypeScript: '#3178C6', Python: '#3572A5', HTML: '#E34C26', CSS: '#563D7C', SCSS: '#C6538C',
  PHP: '#4F5D95', EJS: '#A91E50', PLpgSQL: '#336790', Shell: '#89E051', 'C++': '#F34B7D', Java: '#B07219', Dockerfile: '#384D54'
};

async function datos(){
  const usuario = await api(`/users/${USUARIO}`);
  const repos = (await api(`/users/${USUARIO}/repos?per_page=100&type=owner&sort=pushed`)).filter(r => !r.fork);
  const bytes = {};
  for(const r of repos){
    const l = await api(`/repos/${USUARIO}/${r.name}/languages`);
    for(const [k, v] of Object.entries(l)) bytes[k] = (bytes[k] || 0) + v;
  }
  const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const lenguajes = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([nombre, b]) => ({nombre, pct: b / totalBytes * 100, color: COLOR_LENGUAJE[nombre] || '#8B949E'}));
  const cal = await calendario();
  const ultimo = repos.filter(r => r.name !== USUARIO)[0];
  return {repos: usuario.public_repos, lenguajes, contribuciones: cal.total, ...rachas(cal.dias), ultimo};
}

// ------------------------------------------------------------------ hora de Colombia
function momento(){
  // HORA permite revisar a mano cada versión del banner (por ejemplo HORA=23).
  const hora = process.env.HORA ? +process.env.HORA : +new Intl.DateTimeFormat('en-US', {timeZone: 'America/Bogota', hour: 'numeric', hour12: false}).format(new Date()) % 24;
  const texto = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Bogota', hour: 'numeric'}).format(new Date());
  if(hora >= 5 && hora < 12) return {estado: 'manana', texto, frase: `it's ${texto} in Colombia · Volt is booting up the day`};
  if(hora >= 12 && hora < 18) return {estado: 'tarde', texto, frase: `it's ${texto} in Colombia · building and shipping`};
  if(hora >= 18 && hora < 22) return {estado: 'noche', texto, frase: `it's ${texto} in Colombia · in class at Riwi`};
  return {estado: 'dormido', texto, frase: `it's ${texto} in Colombia · Volt is asleep, see you tomorrow`};
}

// ------------------------------------------------------------------ banner
function banner(m){
  const dormido = m.estado === 'dormido';
  const halo = {manana: C.senal, tarde: C.azul, noche: '#7A5CFF', dormido: '#2A3A7A'}[m.estado];
  // Cara de Volt según el momento del día.
  const cara = {
    manana: `<path d="M36 70q8-11 16 0M68 70q8-11 16 0" fill="none" stroke="#62EEFF" stroke-width="4" stroke-linecap="round"/><path d="M50 88q10 8 20 0" fill="none" stroke="#62EEFF" stroke-width="3.5" stroke-linecap="round"/>`,
    tarde: `<rect class="ojo" x="40" y="56" width="13" height="20" rx="6" fill="#62EEFF"/><rect class="ojo" x="71" y="56" width="13" height="20" rx="6" fill="#62EEFF"/><path d="M52 89h16" stroke="#62EEFF" stroke-width="3.5" stroke-linecap="round"/>`,
    noche: `<rect class="ojo" x="38" y="60" width="13" height="16" rx="6" fill="#62EEFF"/><rect class="ojo" x="69" y="60" width="13" height="16" rx="6" fill="#62EEFF"/><path d="M50 88q10 6 20 0" fill="none" stroke="#62EEFF" stroke-width="3.5" stroke-linecap="round"/>`,
    dormido: `<path d="M36 68h16M68 68h16" stroke="#62EEFF" stroke-width="4" stroke-linecap="round" opacity=".7"/><path d="M54 90h12" stroke="#62EEFF" stroke-width="3" stroke-linecap="round" opacity=".6"/>`
  }[m.estado];
  // Brazo derecho: saluda en la mañana, quieto el resto del día.
  const brazo = m.estado === 'manana'
    ? `<g class="saludo"><rect x="95" y="104" width="13" height="34" rx="6.5" fill="#F1F4FA"/><circle cx="102" cy="102" r="8" fill="#0A0F1A"/></g>`
    : `<rect x="95" y="132" width="13" height="34" rx="6.5" fill="#F1F4FA"/><circle cx="102" cy="170" r="8" fill="#0A0F1A"/>`;
  const extra = {
    // Birrete de graduación: de noche Leonardo está en clase en Riwi.
    noche: `<g transform="translate(14 4)"><rect x="28" y="20" width="36" height="16" rx="3" fill="#2A3550"/><path d="M0 18 46 2l46 16-46 16z" fill="#3A4766" stroke="#6F86C9" stroke-width="1.5" stroke-linejoin="round"/><path d="M46 18h28v20" fill="none" stroke="${C.senal}" stroke-width="2.5" stroke-linecap="round"/><circle cx="74" cy="41" r="4" fill="${C.senal}"/></g>`,
    dormido: `<g class="zz" style="font:700 22px ${MONO}" fill="${C.cian}"><text x="128" y="20">z</text><text x="146" y="0" style="font-size:16px">z</text><text x="160" y="-16" style="font-size:12px">z</text></g>`
  }[m.estado] || '';
  const cielo = dormido
    ? `<g fill="#ECEFF6">${[[640, 40], [720, 90], [860, 30], [930, 120], [1150, 50], [780, 270], [1100, 250], [560, 110]].map(([x, y], i) => `<circle class="estrella" style="animation-delay:${i * .4}s" cx="${x}" cy="${y}" r="1.6"/>`).join('')}</g>
       <circle cx="1140" cy="70" r="22" fill="#ECEFF6" opacity=".9"/><circle cx="1150" cy="62" r="20" fill="${C.fondo}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-label="Leonardo Ayala, Software Developer. ${esc(m.frase)}">
<defs>
  <linearGradient id="grad" x1="0" x2="1"><stop offset="0" stop-color="${C.azul}"/><stop offset=".6" stop-color="${C.cian}"/><stop offset="1" stop-color="#B8F2FF"/></linearGradient>
  <radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${halo}" stop-opacity="${dormido ? .35 : .5}"/><stop offset="1" stop-color="${halo}" stop-opacity="0"/></radialGradient>
  <pattern id="puntos" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#1C2742"/></pattern>
  <filter id="brillo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="marco"><rect width="1200" height="320" rx="20"/></clipPath>
  <style>
    .pista{fill:none;stroke:#1A2A52;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .pulso{fill:none;stroke:${C.cian};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:18 600;stroke-dashoffset:618;animation:corre ${dormido ? 7 : 3.2}s linear infinite}
    .pulso.p2{animation-delay:1.1s}.pulso.p3{stroke:${C.senal};animation-delay:2s}.pulso.p4{animation-delay:.5s}
    @keyframes corre{to{stroke-dashoffset:0}}
    .pad{fill:${C.fondo};stroke:#2C4A9A;stroke-width:2}
    .logo-pista{fill:none;stroke:url(#grad);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
    .logo-pulso{fill:none;stroke:#fff;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:7 93;stroke-dashoffset:100;animation:logo 2.8s linear infinite}
    @keyframes logo{to{stroke-dashoffset:0}}
    .nombre{font:800 64px ${SANS};letter-spacing:-2px}
    .rol{font:500 20px ${MONO};fill:${C.cian}}
    .estado{font:400 19px ${MONO};fill:${C.suave}}
    .escribe{animation:escribe 2.4s steps(60) .4s both}
    @keyframes escribe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
    .cursor{fill:${C.cian};animation:parpadea 1s steps(1) infinite}
    @keyframes parpadea{50%{opacity:0}}
    .volt{animation:flota ${dormido ? 6 : 3.6}s ease-in-out infinite}
    @keyframes flota{50%{transform:translateY(${dormido ? -4 : -10}px)}}
    .ojo{transform-box:fill-box;transform-origin:center;animation:pestanea 4.5s infinite}
    @keyframes pestanea{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
    .bombillo{animation:late 1.6s ease-in-out infinite}
    @keyframes late{50%{opacity:.55}}
    .llama{transform-box:fill-box;transform-origin:top;animation:fuego .18s ease-in-out infinite alternate}
    @keyframes fuego{to{transform:scaleY(1.35)}}
    .saludo{transform-box:fill-box;transform-origin:50% 100%;animation:saluda 1.4s ease-in-out infinite}
    @keyframes saluda{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(18deg)}}
    .zz text{animation:sube 3s ease-in-out infinite}.zz text:nth-child(2){animation-delay:.6s}.zz text:nth-child(3){animation-delay:1.2s}
    @keyframes sube{0%{opacity:0;transform:translateY(10px)}40%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
    .estrella{animation:titila 3s ease-in-out infinite}
    @keyframes titila{50%{opacity:.2}}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}
  </style>
</defs>
<g clip-path="url(#marco)">
  <rect width="1200" height="320" fill="${C.fondo}"/>
  <rect width="1200" height="320" fill="url(#puntos)"/>
  ${cielo}
  <path class="pista" d="M600 330V250l40-40h160l30-30h90"/><path class="pista" d="M1210 60h-120l-40 40h-80l-30 30"/>
  <path class="pista" d="M1210 270h-150l-30-30h-60"/><path class="pista" d="M700 -10v60l30 30h110"/><path class="pista" d="M520 330v-40l30-30h70"/>
  <path class="pulso" d="M600 330V250l40-40h160l30-30h90"/><path class="pulso p2" d="M1210 60h-120l-40 40h-80l-30 30"/>
  <path class="pulso p3" d="M1210 270h-150l-30-30h-60"/><path class="pulso p4" d="M700 -10v60l30 30h110"/>
  <circle class="pad" cx="920" cy="180" r="6"/><circle class="pad" cx="930" cy="130" r="6"/><circle class="pad" cx="970" cy="240" r="6"/><circle class="pad" cx="840" cy="80" r="6"/><circle class="pad" cx="620" cy="260" r="6"/>
  <g transform="translate(64 44)">
    <path class="logo-pista" pathLength="100" d="M6 5V31H27L38 5L49 31"/><path class="logo-pista" d="M32.5 20H43.5"/>
    <path class="logo-pulso" pathLength="100" d="M6 5V31H27L38 5L49 31"/>
    <circle cx="6" cy="5" r="3" fill="${C.fondo}" stroke="${C.cian}" stroke-width="1.8"/><circle cx="49" cy="31" r="3" fill="${C.fondo}" stroke="${C.cian}" stroke-width="1.8"/>
    <text x="70" y="25" style="font:500 17px ${MONO}" fill="${C.texto}">leonardo<tspan fill="${C.cian}">.</tspan>ayala</text>
  </g>
  <text x="64" y="168" class="nombre"><tspan fill="${C.texto}">Leonardo </tspan><tspan fill="url(#grad)">Ayala</tspan></text>
  <text x="66" y="210" class="rol">Software Developer · Systems Engineering</text>
  <g class="escribe"><text x="66" y="252" class="estado">&gt; ${esc(m.frase)}</text></g>
  <rect class="cursor" x="${70 + (m.frase.length + 2) * 10.45}" y="236" width="10" height="20"/>
  <ellipse cx="1040" cy="190" rx="130" ry="110" fill="url(#halo)"/>
  <g class="volt"><g transform="translate(985 58)">
    <line x1="70" y1="8" x2="70" y2="30" stroke="#8E99B0" stroke-width="4"/>
    <circle class="${dormido ? '' : 'bombillo'}" cx="70" cy="7" r="8" fill="${C.senal}" opacity="${dormido ? .35 : 1}" filter="url(#brillo)"/>
    <rect x="8" y="30" width="104" height="86" rx="28" fill="#F1F4FA"/>
    <rect x="-4" y="58" width="14" height="28" rx="6" fill="#0A0F1A"/><rect x="110" y="58" width="14" height="28" rx="6" fill="#0A0F1A"/>
    <rect x="20" y="42" width="80" height="62" rx="16" fill="#071019"/>
    <g filter="url(#brillo)">${cara}</g>
    <rect x="52" y="116" width="16" height="10" fill="#8E99B0"/>
    <rect x="26" y="124" width="68" height="54" rx="20" fill="#F1F4FA"/>
    <circle cx="60" cy="150" r="10" fill="none" stroke="${C.cian}" stroke-width="3.5" opacity="${dormido ? .4 : 1}" filter="url(#brillo)"/>
    <rect x="12" y="132" width="13" height="34" rx="6.5" fill="#F1F4FA"/><circle cx="18" cy="170" r="8" fill="#0A0F1A"/>
    ${brazo}
    <path d="M48 178h24l-3 8h-18z" fill="#8E99B0"/>
    <path class="llama" d="M51 186h18l-9 ${dormido ? 14 : 26}z" fill="${C.cian}" opacity="${dormido ? .5 : 1}" filter="url(#brillo)"/>
    ${extra}
  </g></g>
  <rect x=".5" y=".5" width="1199" height="319" rx="19.5" fill="none" stroke="#1C2742"/>
</g>
</svg>`;
}

// ------------------------------------------------------------------ estadísticas
function haceCuanto(fecha){
  const h = (Date.now() - new Date(fecha)) / 36e5;
  if(h < 1) return 'less than an hour ago';
  if(h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function estadisticas(d){
  const W = 1200, H = 330;
  const cifras = [
    [d.contribuciones, 'contributions', 'in the last year'],
    [d.actual, d.actual === 1 ? 'day' : 'days', 'current streak'],
    [d.larga, d.larga === 1 ? 'day' : 'days', 'longest streak'],
    [d.repos, 'repos', 'public on GitHub']
  ];
  const bloques = cifras.map(([n, unidad, etiqueta], i) => {
    const x = 28 + (i % 2) * 300, y = 120 + Math.floor(i / 2) * 104;
    // La posición va en un grupo aparte: la animación usa transform y la pisaría.
    return `<g transform="translate(${x} ${y})"><g class="cifra" style="animation-delay:${.2 + i * .15}s">
      <text style="font:800 46px ${SANS};letter-spacing:-1.5px" fill="url(#num)">${n}<tspan dx="8" style="font:600 17px ${SANS};letter-spacing:0" fill="${C.cian}">${unidad}</tspan></text>
      <text y="28" style="font:400 15px ${SANS}" fill="${C.suave}">${etiqueta}</text></g></g>`;
  }).join('');
  const X0 = 660, ANCHO = 512;
  let acum = 0;
  const barra = d.lenguajes.map((l, i) => {
    const w = Math.max(l.pct / 100 * ANCHO, 3);
    const s = `<rect class="seg" style="animation-delay:${.3 + i * .12}s" x="${X0 + acum}" y="118" width="${w}" height="14" fill="${l.color}"/>`;
    acum += w;
    return s;
  }).join('');
  const leyenda = d.lenguajes.map((l, i) => {
    const x = X0 + (i % 2) * 262, y = 172 + Math.floor(i / 2) * 36;
    return `<g transform="translate(${x} ${y})"><circle cx="6" cy="-5" r="6" fill="${l.color}"/>
      <text x="22" y="0" style="font:600 16px ${SANS}" fill="${C.texto}">${esc(l.nombre)}</text>
      <text x="230" y="0" text-anchor="end" style="font:400 15px ${MONO}" fill="${C.suave}">${l.pct.toFixed(1)}%</text></g>`;
  }).join('');
  const actualizado = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Bogota', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date());
  const ultimo = d.ultimo ? `latest push · <tspan fill="${C.texto}">${esc(d.ultimo.name)}</tspan>${d.ultimo.language ? ` · ${esc(d.ultimo.language)}` : ''} · ${haceCuanto(d.ultimo.pushed_at)}` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Live GitHub stats: ${d.contribuciones} contributions in the last year, ${d.repos} public repositories">
<style>
  .cifra{opacity:0;animation:aparece .6s ease-out forwards}
  @keyframes aparece{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .seg{transform-box:fill-box;transform-origin:left;transform:scaleX(0);animation:crece .8s cubic-bezier(.2,.7,.2,1) forwards}
  @keyframes crece{to{transform:scaleX(1)}}
  .punto{animation:vivo 2s ease-out infinite}
  @keyframes vivo{0%{r:4;opacity:1}100%{r:12;opacity:0}}
  @media (prefers-reduced-motion:reduce){.cifra,.seg,.punto{animation:none;opacity:1;transform:none}}
</style>
<defs>
  <linearGradient id="num" x1="0" y1="0" x2="0" y2="1"><stop offset=".3" stop-color="#fff"/><stop offset="1" stop-color="${C.azul}"/></linearGradient>
  <linearGradient id="borde" x1="0" x2="1"><stop offset="0" stop-color="${C.azul}"/><stop offset=".5" stop-color="${C.cian}"/><stop offset="1" stop-color="${C.senal}"/></linearGradient>
  <clipPath id="m"><rect width="${W}" height="${H}" rx="16"/></clipPath>
  <clipPath id="barra"><rect x="${X0}" y="118" width="${ANCHO}" height="14" rx="7"/></clipPath>
</defs>
<g clip-path="url(#m)">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="2" fill="url(#borde)"/>
  <circle cx="40" cy="48" r="4" fill="#4ADE80"/><circle class="punto" cx="40" cy="48" r="4" fill="none" stroke="#4ADE80" stroke-width="2"/>
  <text x="56" y="55" style="font:700 26px ${SANS};letter-spacing:-.3px" fill="${C.texto}">Live from GitHub</text>
  <text x="${W - 28}" y="55" text-anchor="end" style="font:400 15px ${MONO}" fill="${C.tenue}">updated ${esc(actualizado)} COT</text>
  ${bloques}
  <line x1="620" y1="100" x2="620" y2="260" stroke="${C.borde}"/>
  <text x="${X0}" y="100" style="font:600 15px ${SANS}" fill="${C.suave}">Languages across my repositories</text>
  <rect x="${X0}" y="118" width="${ANCHO}" height="14" rx="7" fill="#121826"/>
  <g clip-path="url(#barra)">${barra}</g>
  ${leyenda}
  <line x1="28" y1="282" x2="${W - 28}" y2="282" stroke="${C.borde}"/>
  <text x="28" y="310" style="font:400 15px ${MONO}" fill="${C.tenue}">${ultimo}</text>
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="15.5" fill="none" stroke="${C.borde}"/>
</svg>`;
}

// ------------------------------------------------------------------ salida
const m = momento();
writeFileSync(join(SALIDA, 'header.svg'), banner(m));
if(process.env.SOLO_BANNER){ console.log(`banner: ${m.estado} (${m.texto})`); process.exit(0); }
// DATOS_EJEMPLO=1 dibuja la tarjeta sin consultar la API (solo para revisar el diseño).
const d = process.env.DATOS_EJEMPLO
  ? {contribuciones: 295, actual: 1, larga: 8, repos: 48, ultimo: {name: 'portfolio', language: 'JavaScript', pushed_at: new Date(Date.now() - 8 * 36e5).toISOString()},
     lenguajes: [['JavaScript', 42.3], ['CSS', 17.1], ['HTML', 12.7], ['Python', 10.5], ['TypeScript', 8.1], ['PHP', 7.6]].map(([nombre, pct]) => ({nombre, pct, color: COLOR_LENGUAJE[nombre]}))}
  : await datos();
writeFileSync(join(SALIDA, 'stats.svg'), estadisticas(d));
console.log(`banner: ${m.estado} (${m.texto}) · contribuciones: ${d.contribuciones} · racha: ${d.actual}/${d.larga} · repos: ${d.repos}`);
console.log('lenguajes:', d.lenguajes.map(l => `${l.nombre} ${l.pct.toFixed(1)}%`).join(', '));
