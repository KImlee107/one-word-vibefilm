// Only appearance preferences are stored here; video styles and model keys are separate.
(function(){
  const key='jianzhi-appearance-v1';let saved={};
  try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
  const fallback=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  const theme=['light','dark'].includes(saved.theme)?saved.theme:fallback;
  const size=[18,20,22].includes(saved.size)?saved.size:18;
  document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;
  document.documentElement.style.setProperty('--ui-size',size+'px');
  window.JianzhiAppearance={theme,size};
})();
