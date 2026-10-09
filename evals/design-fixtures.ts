// Deterministic adversarial and clean fixtures; no browser or network required.
export const badHtml = '<div onclick="save()">Save</div><img src="preview.png"><input type="text">';
export const badCss = '.bad:focus { outline: none; } .bad { color: #aaa; background-color: #fff; }';
export const cleanHtml = '<article><h2>Static card</h2><p>Reading content.</p></article><label for="name">Name</label><input id="name"><button type="button">Save</button><button type="button" disabled>Unavailable</button><img src="decoration.svg" alt="">';
export const cleanCss = ':root { --md-sys-color-primary: #546a2f; --md-sys-color-on-primary: #fff; } button { color: var(--md-sys-color-on-primary); background-color: var(--md-sys-color-primary); }';
