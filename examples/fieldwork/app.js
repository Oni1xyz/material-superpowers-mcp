// Fictional local-only demo. No services, accounts, telemetry, or real trail data.
const trips = {
  ridge: {name: 'Bracken Ridge', terrain: 'High country · Moderate', image: 'ridge.svg', distance: '12.4 km', time: '4–5 hr', climb: '640 m', description: 'Leave the tree line behind. A long, open ridge leads to a sheltered lunch spot with a view across the whole North Country.', itinerary: [['08:30','Set out from Alder Camp'],['10:15','Follow the ridge to the Lookout'],['12:00','A slow lunch above the valley'],['14:00','Return by the old bracken path']]},
  lake: {name: 'Stillwater Loop', terrain: 'Water’s edge · Easy going', image: 'lake.svg', distance: '6.8 km', time: '2–3 hr', climb: '120 m', description: 'An unhurried loop around Stillwater Lake. Walk through silver birch, pause at the north shore, and take the long way back.', itinerary: [['09:00','Start at the old boathouse'],['10:00','Coffee beside the north shore'],['11:15','Wander through the birch grove'],['12:00','Back in time for a late breakfast']]},
  forest: {name: 'Fernwood Trail', terrain: 'Into the green · Easy going', image: 'forest.svg', distance: '8.2 km', time: '3–4 hr', climb: '210 m', description: 'A soft trail under a canopy of evergreen. Follow Fern Creek to a quiet clearing, then retrace your steps through the green.', itinerary: [['08:45','Meet the trail at Fern Gate'],['10:00','Cross the little creek bridge'],['11:15','Unpack a picnic in the clearing'],['12:30','Return beneath the cedar canopy']]}
};
const storageKey = 'fieldwork-demo-v1';
const defaults = {saved:['lake'],packed:['water','boots'],theme:'light'};
let state = {...defaults};
try {
  const stored = JSON.parse(localStorage.getItem(storageKey));
  if (stored && typeof stored === 'object') state = {
    saved: Array.isArray(stored.saved) ? [...new Set(stored.saved.filter(id=>Object.hasOwn(trips,id)))] : defaults.saved,
    packed: Array.isArray(stored.packed) ? stored.packed.filter(id=>['water','boots','layer','snacks','map'].includes(id)) : defaults.packed,
    theme: stored.theme === 'dark' ? 'dark' : 'light'
  };
} catch { /* Storage can be unavailable; interactions still work in memory. */ }
const $ = s => document.querySelector(s);
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000); }
function persist() { try { localStorage.setItem(storageKey,JSON.stringify(state)); } catch { toast('Changes kept for this visit; browser storage is unavailable.'); } }
function theme() { document.documentElement.dataset.theme=state.theme; $('#theme-toggle').setAttribute('aria-pressed',String(state.theme==='dark')); $('#theme-toggle').setAttribute('aria-label',`Switch to ${state.theme==='dark'?'light':'dark'} theme`); }
$('#theme-toggle').addEventListener('click',()=>{ state.theme=state.theme==='dark'?'light':'dark'; theme(); persist(); }); theme();
function renderPlan() {
  $('#nav-count').textContent=String(state.saved.length).padStart(2,'0');
  $('#plan-count').textContent=`${state.saved.length} route${state.saved.length===1?'':'s'} saved`;
  $('#saved-routes').replaceChildren();
  if (!state.saved.length) {const p=document.createElement('p');p.className='empty-plan';p.textContent='A blank page. A good place to start.';$('#saved-routes').append(p);}
  state.saved.forEach(id=>{
    const trip=trips[id];const row=document.createElement('div');row.className='saved-route';
    const image=document.createElement('img');image.src=`assets/${trip.image}`;image.alt='';
    const button=document.createElement('button');button.dataset.trip=id;button.textContent=trip.name;
    const meta=document.createElement('small');meta.textContent=`${trip.distance} · ${trip.time}`;button.append(meta);
    const remove=document.createElement('button');remove.className='remove-route';remove.dataset.save=id;remove.textContent='×';remove.setAttribute('aria-label',`Remove ${trip.name} from fieldbook`);
    row.append(image,button,remove);$('#saved-routes').append(row);
  });
  document.querySelectorAll('.save-button').forEach(button=>{const saved=state.saved.includes(button.dataset.save);button.setAttribute('aria-pressed',String(saved));button.setAttribute('aria-label',`${saved?'Unsave':'Save'} ${trips[button.dataset.save].name}`);});
}
function toggleSave(id) { const wasSaved=state.saved.includes(id);state.saved=wasSaved?state.saved.filter(x=>x!==id):[...state.saved,id];renderPlan();persist();toast(`${trips[id].name} ${wasSaved?'removed from':'added to'} your fieldbook.`); }
const dialog=$('#trip-dialog');let currentTrip='ridge';let opener=null;
function openTrip(id,trigger) {
  currentTrip=id;opener=trigger;const trip=trips[id];
  $('#dialog-title').textContent=trip.name;$('#dialog-category').textContent=trip.terrain;$('#dialog-description').textContent=trip.description;$('#dialog-image').src=`assets/${trip.image}`;
  $('#dialog-stats').replaceChildren();[['Distance',trip.distance],['On the trail',trip.time],['Elevation gain',trip.climb]].forEach(([label,value])=>{const item=document.createElement('div');item.textContent=value;const small=document.createElement('small');small.textContent=label;item.append(small);$('#dialog-stats').append(item);});
  $('#dialog-itinerary').replaceChildren();trip.itinerary.forEach(([time,activity])=>{const li=document.createElement('li');const strong=document.createElement('strong');strong.textContent=time;li.append(strong,document.createTextNode(activity));$('#dialog-itinerary').append(li);});
  $('#dialog-save').textContent=state.saved.includes(id)?'Remove from fieldbook':'Add to fieldbook';dialog.showModal();
}
document.addEventListener('click',event=>{
  const tripButton=event.target.closest('[data-trip]');if(tripButton)openTrip(tripButton.dataset.trip,tripButton);
  const saveButton=event.target.closest('[data-save]');if(saveButton){const inPlan=saveButton.classList.contains('remove-route');toggleSave(saveButton.dataset.save);if(inPlan)$('#weekend .add-route').focus();}
});
$('#dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{ if(opener?.isConnected) opener.focus(); else $('#weekend .add-route').focus(); });
// Keep the keyboard cycle on the two modal actions; Chrome can otherwise
// move focus to the browser/body boundary when tabbing backwards.
dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab') return;
  const controls=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')];
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)) { event.preventDefault();last.focus(); }
  else if(!event.shiftKey&&document.activeElement===last) { event.preventDefault();first.focus(); }
});
dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
$('#dialog-save').addEventListener('click',()=>{toggleSave(currentTrip);dialog.close();});
const chips=[...document.querySelectorAll('[data-filter]')];
chips.forEach((chip,index)=>{
  chip.addEventListener('click',()=>{chips.forEach(other=>other.setAttribute('aria-pressed',String(other===chip)));let count=0;document.querySelectorAll('[data-terrain]').forEach(card=>{card.hidden=chip.dataset.filter!=='all'&&card.dataset.terrain!==chip.dataset.filter;if(!card.hidden)count++;});$('#result-count').textContent=`${count} route${count===1?'':'s'}`;});
  chip.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?chips.length-1:(index+(event.key==='ArrowRight'?1:-1)+chips.length)%chips.length;chips[next].focus();});
});
function packing() {const inputs=[...document.querySelectorAll('.packing-list input')];inputs.forEach(input=>input.checked=state.packed.includes(input.name));$('#packing-count').textContent=`${state.packed.length} / ${inputs.length}`;$('#packing-progress').value=state.packed.length;$('#packing-progress').textContent=`${state.packed.length} of ${inputs.length}`;}
document.querySelectorAll('.packing-list input').forEach(input=>input.addEventListener('change',()=>{state.packed=[...document.querySelectorAll('.packing-list input:checked')].map(item=>item.name);packing();persist();}));
renderPlan();packing();
