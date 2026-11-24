const $ = id => document.getElementById(id);
const svg = (name, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const metrics = {
  frost: {name:"Gelo", title:"Giorni con gelo", icon:"M8 1v14M2 5l12 6M2 11l12-6M6 3l2 2 2-2M6 13l2-2 2 2",
    copy:"Conta i giorni in cui la temperatura minima stimata è scesa a 0 °C o meno.",
    tip:"Più giorni colorati indicano gelate più frequenti. Il gelo vicino al suolo può differire dalla temperatura dell’aria.",
    unit:"gg", range:[0,30], stops:["#f3f6f3","#bddae3","#6aa7cd","#425da2","#303464"]},
  rain: {name:"Piogge scarse", title:"Pioggia accumulata", icon:"M8 1S3 7 3 10a5 5 0 0 0 10 0c0-3-5-9-5-9z",
    copy:"Mostra quanta pioggia è caduta nel periodo. I toni ocra evidenziano gli accumuli più bassi.",
    tip:"Sotto 30 mm è un segnale orientativo di poche piogge, non una diagnosi di siccità.",
    unit:"mm", range:[0,180], stops:["#955020","#d2924d","#f4e6b9","#75a9a1","#285b78"], reverse:true},
  storm: {name:"Piogge intense", title:"Massima pioggia in un giorno", icon:"M4 9H12a3 3 0 0 0 0-6 4 4 0 0 0-7-.5A3.3 3.3 0 0 0 4 9zm2 2-1 3m4-3-1 3m4-3-1 3",
    copy:"Indica il massimo accumulo stimato in una singola giornata dell’ultimo mese.",
    tip:"Da 50 mm in un giorno il segnale è marcato. Una media giornaliera non misura i picchi di pochi minuti.",
    unit:"mm", range:[0,100], stops:["#eef4ee","#9fcacb","#559ba8","#536ca9","#3c3877"]},
  heat: {name:"Caldo", title:"Giorni di caldo intenso", icon:"M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.4 1.4m7.2 7.2L13 13M3 13l1.4-1.4m7.2-7.2L13 3M11.4 8a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0z",
    copy:"Conta i giorni con massima stimata di almeno 30 °C.",
    tip:"Misura la frequenza del caldo diurno, non la durata di un’ondata né lo stress termico delle persone.",
    unit:"gg", range:[0,30], stops:["#f7f4e8","#f2d59a","#e2a05c","#c15f3e","#862f36"]},
  gdd: {name:"Potenziale agricolo", title:"Calore utile per le colture", icon:"M8 15V7m0 4C7 6 3 5 1 6c0 4 3 6 7 5zm0-3c1-5 4-6 7-6 0 4-3 6-7 6z",
    copy:"Somma il calore sopra 10 °C giorno per giorno nella stagione vegetativa, in gradi-giorno (°C·g).",
    tip:"Una somma più alta indica più calore disponibile, non necessariamente rese migliori. Confronta fasce di quota simili.",
    unit:"°C·g", range:[0,2500], stops:["#f4f3da","#c7d99a","#8bb56e","#4a8d62","#225746"]},
  mean: {name:"Temperatura", title:"Temperatura media", icon:"M7 2a1.5 1.5 0 0 1 3 0v7a3.2 3.2 0 1 1-3 0zm1.5 4v5m0 0v1",
    copy:"Mostra la temperatura media stimata per l’ultima giornata completa.",
    tip:"Le stime tengono conto della quota ma non rappresentano tutti i microclimi di un singolo versante.",
    unit:"°C", range:[-15,30], stops:["#3e488b","#7aa9ca","#f1efcf","#e9a85f","#9e3f37"]},
};
const bands = {all:"Tutte le quote",low:"Meno di 800 m",mid:"Da 800 a 1.399 m",high:"Da 1.400 m"};
const bandBounds = {all:[0,5000],low:[0,800],mid:[800,1400],high:[1400,5000]};
const cities = [["Trento",11.121,46.068],["Rovereto",11.041,45.890],["Riva del Garda",10.842,45.886],
  ["Cles",11.034,46.361],["Malè",10.911,46.353],["Tione",10.727,46.032],
  ["Cavalese",11.461,46.290],["Canazei",11.774,46.476],["Borgo Valsugana",11.456,46.053],
  ["Fiera di Primiero",11.830,46.176],["Pinzolo",10.767,46.162]];
const nav = {
  mappa:["Il meteo, valle per valle.","Dalle stazioni al territorio: esplora gelo, caldo e piogge, oppure confronta il calore disponibile per le colture."],
  valli:["Il clima a parità di quota.","Quali zone accumulano più calore? Dove il gelo è più frequente? Confronta le medie territoriali senza mescolare fondovalle e alta montagna."],
  metodo:["Dalle misure alla mappa.","Da dove arrivano i dati, come diventano stime territoriali e cosa non possiamo concludere."],
};
const state = {mapMetric:"frost",compareMetric:"gdd",mapBand:"all",compareBand:"low",zone:11,zoom:1,data:null};
const frame = $("atlas-map");
const it = new Intl.NumberFormat("it-IT",{maximumFractionDigits:1});
const fmt = v => it.format(v);
const pct = v => Math.round(v * 100) + "%";
const value = (number, key) => fmt(number) + " " + metrics[key].unit;
const day = iso => new Intl.DateTimeFormat("it-IT",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(iso));
const when = iso => new Intl.DateTimeFormat("it-IT",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Rome"}).format(new Date(iso));
const activeView = () => Object.hasOwn(nav,location.hash.slice(1)) ? location.hash.slice(1) : "mappa";
const period = key => {
  const d = state.data;
  if (key === "mean") return day(d.latest);
  const [a,b] = key === "gdd" ? [d.seasonStart,d.seasonEnd] : [d.start,d.latest];
  return a === b ? day(a) : day(a) + " – " + day(b);
};

function el(tag, content, cls) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (cls) node.className = cls;
  return node;
}
function option(select, key, text) {
  select.add(new Option(text,key));
}
function decode(str) {
  const binary = atob(str), out = new Int16Array(binary.length / 2);
  for (let j=0;j<out.length;j++) out[j] = binary.charCodeAt(2*j) | (binary.charCodeAt(2*j+1) << 8);
  return out;
}
function createMetricControls(container, property, rerender) {
  for (const [key,m] of Object.entries(metrics)) {
    const button = el("button");
    button.type = "button";
    button.dataset.key = key;
    const icon = svg("svg",{viewBox:"0 0 16 16","aria-hidden":"true"});
    icon.append(svg("path",{d:m.icon}));
    button.append(icon,document.createTextNode(m.name));
    button.addEventListener("click", () => { state[property] = key; rerender(); });
    container.append(button);
  }
}
function pressed(container, key) {
  for (const button of container.children) button.setAttribute("aria-pressed",String(button.dataset.key === key));
}
function project(lon,lat) {
  const {west,north,dx,dy} = state.data.grid;
  return [(lon - west)/dx,(north - lat)/dy];
}
function zonePath(g) {
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polygons.map(p => p.map(r => r.map(([lon,lat],i) =>
    (i === 0 ? "M" : "L") + project(lon,lat).map(x => x.toFixed(2)).join(",")).join("") + "Z").join("")).join("");
}
function hideTooltip() { $("tooltip").hidden=true; }
function tooltip(x,y,title,text) {
  const box=$("tooltip"), map=$("map-figure").getBoundingClientRect();
  box.replaceChildren(el("strong",title),el("div",text));
  box.hidden=false;
  box.style.left=Math.max(5,Math.min(x-map.left+9,map.width-box.offsetWidth-5))+"px";
  box.style.top=Math.max(5,Math.min(y-map.top+9,map.height-box.offsetHeight-5))+"px";
}
function positionFromPointer(event) {
  const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(frame.getScreenCTM().inverse());
  return [Math.floor(p.x),Math.floor(p.y)];
}
function placeTooltip(event) {
  if (!state.data || event.target.classList.contains("station")) return;
  const {w,h}=state.data.grid;
  const [x,y]=positionFromPointer(event);
  if (x<0 || y<0 || x>=w || y>=h) return hideTooltip();
  const i=y*w+x, id=state.zoneArray[i], z=state.elevation[i];
  const [lo,hi]=bandBounds[state.mapBand];
  if (id<1 || z<lo || z>=hi) return hideTooltip();
  const layer=state.data.layers[state.mapMetric], raw=layer.values[i];
  tooltip(event.clientX,event.clientY,state.zoneById[id].name,
    raw===-32768 ? "Stima non disponibile · "+fmt(z)+" m" : value(raw/layer.scale,state.mapMetric)+" · "+fmt(z)+" m");
}
function drawBase() {
  const d=state.data, {w,h}=d.grid;
  frame.replaceChildren();
  state.raster = svg("image",{x:0,y:0,width:w,height:h,"aria-hidden":"true","pointer-events":"none"});
  state.shapes=svg("g",{"aria-hidden":"true"});
  state.names=svg("g",{"aria-hidden":"true"});
  state.stationLayer=svg("g",{"aria-label":"Stazioni con misure nell’ultimo giorno"});
  frame.append(state.raster,state.shapes,state.names,state.stationLayer);

  let minX=w,minY=h,maxX=0,maxY=0;
  for (let i=0;i<state.elevation.length;i++) if (state.elevation[i]!==-32768) {
    const x=i%w,y=Math.floor(i/w);
    minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
  }
  state.bounds=[minX-7,minY-7,maxX-minX+15,maxY-minY+15];
  for (const z of d.zones) {
    const path=svg("path",{d:zonePath(z.geometry),class:"zone-shape","data-zone":z.id,"fill-rule":"evenodd"});
    path.addEventListener("click",() => { state.zone=z.id; $("map-zone").value=z.id; drawSelection(); readZone(); });
    state.shapes.append(path);
  }
  state.selection=svg("path",{class:"zone-shape selected","fill-rule":"evenodd"});
  state.shapes.append(state.selection);
  for (const [name,lon,lat] of cities) {
    const [x,y]=project(lon,lat);
    state.names.append(svg("circle",{cx:x,cy:y,r:.75,fill:"#263e35",stroke:"#fff","stroke-width":.25,"pointer-events":"none"}));
    const label=svg("text",{x:x+1.6,y:y+.95,class:"place-label",
      style:"font-size:3.2px;stroke-width:0.7px"});
    label.textContent=name;
    state.names.append(label);
  }
  for (const s of d.stations) {
    const [x,y]=project(s.lon,s.lat);
    const circle=svg("circle",{cx:x,cy:y,r:1.05,class:"station",style:"stroke-width:.33px",tabindex:0,
      "aria-label":s.name});
    const description=[s.mean != null ? "Media "+value(s.mean,"mean") : "",s.rain != null ? "Pioggia "+value(s.rain,"rain") : ""].filter(Boolean).join(" · ");
    const label=svg("title");
    label.textContent=s.name+" · "+description;
    circle.append(label);
    const show = e => {
      let x=e.clientX,y=e.clientY;
      if (x==null) { const r=circle.getBoundingClientRect(); x=r.left; y=r.top; }
      tooltip(x,y,s.name+" · "+fmt(s.z)+" m",description);
    };
    circle.addEventListener("pointerenter",show);
    circle.addEventListener("focus",show);
    circle.addEventListener("blur",hideTooltip);
    circle.addEventListener("pointerleave",hideTooltip);
    state.stationLayer.append(circle);
  }
  toggleStations();
  updateZoom();
}
function drawSelection() {
  state.selection.setAttribute("d",zonePath(state.zoneById[state.zone].geometry));
}
function toggleStations() {
  if (state.stationLayer) state.stationLayer.style.display=$("show-stations").checked ? "" : "none";
}
function updateZoom() {
  if (!state.data) return;
  const [x,y,w,h]=state.bounds, z=state.zoom;
  const [cx,cy]=z===1 ? [x+w/2,y+h/2] : project(...state.zoneById[state.zone].center);
  const width=w/z,height=h/z;
  const clamp=(v,min,max)=>Math.min(Math.max(v,min),max);
  frame.setAttribute("viewBox",[clamp(cx-width/2,x,x+w-width),clamp(cy-height/2,y,y+h-height),width,height].join(" "));
  $("zoom-in").disabled=z>=3;
  $("zoom-out").disabled=z<=1;
  hideTooltip();
}
function gradient(hexs,lo,hi,v) {
  const p=Math.max(0,Math.min(1,(v-lo)/(hi-lo)))*(hexs.length-1), a=Math.floor(p), b=Math.min(hexs.length-1,a+1);
  return hexs[a].map((v,j) => v+(hexs[b][j]-v)*(p-a));
}
function renderRaster() {
  const d=state.data, {w,h}=d.grid, z=state.elevation, layer=d.layers[state.mapMetric];
  const canvas=document.createElement("canvas"); canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext("2d"), img=ctx.createImageData(w,h);
  const m=metrics[state.mapMetric], [low,high]=m.range, [bandLo,bandHi]=bandBounds[state.mapBand];
  const colors=m.stops.map(c => [1,3,5].map(j => parseInt(c.slice(j,j+2),16)));
  const at=(i, fallback) => z[i]!==undefined && z[i]!==-32768 ? z[i] : fallback;
  for (let i=0;i<z.length;i++) {
    if (z[i]===-32768) continue;
    const iy=Math.floor(i/w), ix=i%w, val=layer.values[i], outside=z[i]<bandLo || z[i]>=bandHi;
    const slope=at(i+1,z[i])-at(i-1,z[i])+at(i+w,z[i])-at(i-w,z[i]);
    const shade=Math.max(-23,Math.min(22,slope*.069));
    const rgb=outside ? [214,224,209] : val===-32768 ?
      ((ix+iy)%5<2 ? [175,188,175] : [224,231,218]) : gradient(colors,low,high,val/layer.scale);
    for (let j=0;j<3;j++) img.data[4*i+j]=rgb[j]+(outside ? shade*.3 : shade);
    img.data[4*i+3]=255;
  }
  ctx.putImageData(img,0,0);
  state.raster.setAttribute("href",canvas.toDataURL());
}
function legend() {
  const m=metrics[state.mapMetric], [lo,hi]=m.range;
  const labels=el("div",null,"legend-text");
  labels.append(el("span",m.unit==="gg" ? "GIORNI STIMATI" : "VALORI STIMATI"),el("span","Nessuna stima","no-data"));
  const ramp=el("div",null,"legend-ramp");
  ramp.style.background="linear-gradient(90deg,"+m.stops.join(",")+")";
  const scale=el("div",null,"legend-scale");
  scale.append(el("span",value(lo,state.mapMetric)),el("span",value((lo+hi)/2,state.mapMetric)),el("span",
    (m.unit==="gg" ? "" : "≥ ")+value(hi,state.mapMetric)));
  $("legend").replaceChildren(labels,ramp,scale);
}
function zoneStat(z,band,key) { return z.bands[band].stats[key]; }
function readZone() {
  const z=state.zoneById[state.zone], key=state.mapMetric, band=state.mapBand, stats=zoneStat(z,band,key);
  const box=$("zone-read");
  if (!stats) {
    box.replaceChildren(el("p",z.bands[band].km2 ? "Nessuna stima per questa fascia." : "In questo territorio non ci sono celle nella fascia selezionata.","stat-meta"));
    return;
  }
  box.replaceChildren(el("div","Media del territorio","stat-tag"),el("div",value(stats.mean,key),"stat-big"),
    el("div","Da "+fmt(stats.min)+" a "+value(stats.max,key)+" · Copertura "+pct(stats.coverage),"stat-meta"));
}
function renderMap() {
  pressed($("metrics"),state.mapMetric);
  if (!state.data) return;
  const key=state.mapMetric, m=metrics[key];
  $("map-band").value=state.mapBand;
  $("map-zone").value=state.zone;
  $("metric-title").textContent=m.title;
  $("metric-copy").textContent=m.copy;
  $("metric-tip").textContent=m.tip;
  $("period").textContent=period(key);
  drawSelection(); renderRaster(); legend(); readZone(); hideTooltip();
}
function compare() {
  const key=state.compareMetric, band=state.compareBand, m=metrics[key];
  pressed($("compare-metrics"),key);
  if (!state.data) return;
  $("compare-band").value=band;
  $("compare-period").textContent=period(key);
  $("sort-label").textContent=m.reverse ? "Media ↑" : "Media ↓";
  const score=s=>s?.coverage>=.6 ? 2 : s ? 1 : 0;
  const zones=state.data.zones.map(z=>[z,zoneStat(z,band,key)]).sort(([a,s],[b,t]) =>
    score(t)-score(s) || (m.reverse ? 1 : -1)*((s?.mean??0)-(t?.mean??0)) || a.name.localeCompare(b.name,"it"));
  const [first,top]=zones[0];
  if (score(top)===2) {
    $("leader-title").textContent=first.name;
    $("leader-text").textContent=(m.reverse ? "Media più bassa" : "Media più alta")+" nella fascia selezionata: "+value(top.mean,key)+
      " ("+pct(top.coverage)+" di copertura). Il confronto include solo i territori con almeno il 60% di copertura.";
  } else {
    $("leader-title").textContent="Dati limitati";
    $("leader-text").textContent="Nessun territorio raggiunge il 60% di copertura per questo confronto.";
  }
  const body=$("compare-rows");
  body.replaceChildren();
  for (const [z,s] of zones) {
    const tr=el("tr"), title=el("th",z.name), mean=el("td",s ? value(s.mean,key) : "—","bar-cell");
    title.scope="row";
    if (s) {
      const [lo,hi]=m.range, bar=el("span",null,"bar"), inside=el("span");
      inside.style.width=Math.max(0,Math.min(100,100*(s.mean-lo)/(hi-lo)))+"%";
      bar.setAttribute("aria-hidden","true"); bar.append(inside); mean.append(bar);
    }
    const mapLink=el("a","Mappa →","inline-link");
    mapLink.href="#mappa";
    mapLink.setAttribute("aria-label","Mostra "+z.name+" sulla mappa");
    mapLink.addEventListener("click",()=>{
      state.mapMetric=key; state.mapBand=band; state.zone=z.id; state.zoom=1.55;
      updateZoom(); renderMap();
    });
    const linkCell=el("td"); linkCell.append(mapLink);
    tr.append(title,mean,el("td",s ? fmt(s.min)+" – "+value(s.max,key) : "—"),
      el("td",s ? pct(s.coverage)+(score(s)===1 ? " · limitata" : "") : (z.bands[band].km2 ? "0%" : "Fuori fascia"),score(s)===1 ? "flag" : ""),linkCell);
    body.append(tr);
  }
}
function showRoute() {
  const which=activeView();
  for (const key of Object.keys(nav)) {
    $(key).hidden=key!==which;
    if (key===which) $("link-"+key).setAttribute("aria-current","page");
    else $("link-"+key).removeAttribute("aria-current");
  }
  $("page-title").textContent=nav[which][0];
  $("intro").textContent=nav[which][1];
  hideTooltip();
  if (which==="mappa") renderMap();
  if (which==="valli") compare();
}
function populate(d) {
  state.data=d;
  state.elevation=decode(d.elevation);
  state.zoneArray=decode(d.zoneGrid);
  state.zoneById=Object.fromEntries(d.zones.map(z=>[z.id,z]));
  for (const layer of Object.values(d.layers)) layer.values=decode(layer.data);
  for (const z of [...d.zones].sort((a,b)=>a.name.localeCompare(b.name,"it"))) option($("map-zone"),z.id,z.name);
  $("latest").textContent=day(d.latest);
  const stale=Date.now()-Date.parse(d.latest)>3*86400000;
  $("source-status").textContent=stale ? "DATI NON RECENTI" : "ULTIMO GIORNO OSSERVATO";
  $("source-status").closest(".fresh").classList.toggle("stale",stale);
  $("network").textContent=d.stations.length+" stazioni · Meteotrentino";
  const modes={cron:"Pianificazione giornaliera",programma:"Pubblicazione pianificata",manual:"Esecuzione manuale",deploy:"Prima pubblicazione"};
  const run=$("run-data");
  for (const [k,v] of [["Elaborato il",when(d.updatedAt)],["Versione archivio",d.sourceVersion],["Tipo di esecuzione",modes[d.trigger]??"Non disponibile"]]) {
    run.append(el("dt",k),el("dd",v));
  }
  drawBase(); showRoute();
}
async function load() {
  $("error").hidden=true;
  $("source-status").textContent="CARICAMENTO DATI";
  try {
    const response=await fetch("data/atlas.json",{cache:"no-cache"});
    if (!response.ok) throw new Error("Dati non disponibili");
    const d=await response.json();
    if (d.schema!==1) throw new Error("Formato dati non supportato");
    populate(d);
  } catch (err) {
    console.error(err);
    $("error").hidden=false;
    $("source-status").textContent="DATI NON DISPONIBILI";
  }
}

createMetricControls($("metrics"),"mapMetric",renderMap);
createMetricControls($("compare-metrics"),"compareMetric",compare);
for (const [k,label] of Object.entries(bands)) {
  option($("map-band"),k,label); option($("compare-band"),k,label);
}
$("map-band").addEventListener("change", e=>{state.mapBand=e.target.value;renderMap();});
$("compare-band").addEventListener("change", e=>{state.compareBand=e.target.value;compare();});
$("map-zone").addEventListener("change",e=>{state.zone=Number(e.target.value);drawSelection();readZone();updateZoom();});
$("show-stations").addEventListener("change",toggleStations);
$("zoom-in").addEventListener("click",()=>{state.zoom=Math.min(3,state.zoom+.55);updateZoom();});
$("zoom-out").addEventListener("click",()=>{state.zoom=Math.max(1,state.zoom-.55);updateZoom();});
$("zoom-reset").addEventListener("click",()=>{state.zoom=1;updateZoom();});
$("retry").addEventListener("click",load);
frame.addEventListener("pointermove",placeTooltip);
frame.addEventListener("pointerleave",hideTooltip);
window.addEventListener("hashchange",()=>{showRoute();window.scrollTo(0,0);});
showRoute();
load();
