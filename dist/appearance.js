export function initializeAppearance(){
  const state=window.JianzhiAppearance||{theme:'light',size:18};
  const toggle=document.getElementById('themeToggle'),size=document.getElementById('uiFontSize');
  function apply(){
    document.documentElement.dataset.theme=state.theme;document.documentElement.style.colorScheme=state.theme;document.documentElement.style.setProperty('--ui-size',state.size+'px');
    const next=state.theme==='dark'?'日间':'夜间';toggle.setAttribute('aria-label','切换到'+next+'模式');toggle.setAttribute('aria-pressed',String(state.theme==='dark'));
    toggle.querySelector('use').setAttribute('href',state.theme==='dark'?'#i-sun':'#i-moon');toggle.querySelector('span').textContent=next+'模式';size.value=String(state.size);
  }
  function save(){try{localStorage.setItem('jianzhi-appearance-v1',JSON.stringify({theme:state.theme,size:state.size}));}catch{}}
  toggle.addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';apply();save();});
  size.addEventListener('change',()=>{const value=Number(size.value);if([18,20,22].includes(value)){state.size=value;apply();save();}});
  apply();return state;
}
