// Paste this in Meet DevTools console to find caption selectors
(function() {
  console.log('=== NOTETAKER DIAGNOSTIC ===');
  
  // Find all text nodes that contain Ukrainian/speech text
  // and log their parent structure
  function findTextElements() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found = [];
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text.length > 10 && text.length < 500 && 
          /[а-яА-ЯіїєёІЇЄ]/.test(text)) { // Ukrainian chars
        found.push({
          text: text.slice(0, 80),
          parent: node.parentElement,
          classes: node.parentElement?.className,
          jsname: node.parentElement?.getAttribute('jsname'),
          grandparent: node.parentElement?.parentElement?.getAttribute('jsname'),
          grandClasses: node.parentElement?.parentElement?.className
        });
      }
    }
    found.slice(0, 10).forEach(f => {
      console.log('TEXT:', f.text);
      console.log('  parent class:', f.classes, '| jsname:', f.jsname);
      console.log('  grandparent jsname:', f.grandparent, '| class:', f.grandClasses);
      console.log('---');
    });
  }
  
  // Also log all aria-live elements
  document.querySelectorAll('[aria-live]').forEach(el => {
    console.log('ARIA-LIVE:', el.getAttribute('aria-live'), 
      '| class:', el.className.slice(0,50), 
      '| text:', el.textContent.slice(0,80));
  });
  
  findTextElements();
  
  // Log the bottom transcript area structure
  console.log('\n=== BOTTOM TRANSCRIPT AREA ===');
  // The bottom area in your screenshot shows "You + text"
  document.querySelectorAll('[data-sender-name], [jsname="r8qRAd"]').forEach(el => {
    console.log('data-sender-name:', el.getAttribute('data-sender-name'), el.className);
  });
})();
