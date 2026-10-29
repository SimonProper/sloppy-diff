// @ts-nocheck
import HL from './kernel.js';

/**
 * Sorter: a terminal on a console that feeds a sorting bed. Cards come out of
 * the console onto a belt, ride to their slot and drop in, one after another,
 * for as long as it runs. The monitor is an old tube set looking down the belt, and its
 * screen is left bare: the page puts its own words there (`screen`, in viewBox
 * units). Hovering slows the belt so a card can be followed, and the slot under
 * the pointer takes the bright edge from the one that last took a card.
 *
 * The pattern: ambient motion. Belt distance is the one clock, every card is a
 * function of it, and a spring on the rate lets the pointer slow it. Slots are
 * picked on the bed's top plane, which never moves.
 */
const {
  Cam, EASE_LIFT, clamp, facing, fit, hull, lerp, open, poly, prism, proj, ringAt, rings, rrect, run, seg,
  spring, stepS, unproj, disposer, mk, place, pointer, put, reducedMotion, register, solid,
} = HL;

const CON = [-96, -40, 0, 40, 30]; // the console: x0 y0 x1 y1, height
const BED = [0, -22, 134, 34, 24]; // the sorting bed beside it
const BELT = [0, 16, 130, 30, 29]; // along the bed's front, coming out of the console
const SLOTS = [34, 61, 88, 115], SW = 24, SY0 = -12, SY1 = 6, SD = 14;
const L = 22, CW = 12, CT = 0.8; // a card: along the belt, across it, thick
// the monitor, a tube set facing +x, down the belt, in its own frame: u along -y, w along x from MC. A bezel box, a
// tube tapering back from it, and a bevel stepping in to a recessed screen
const MC = [-52, 0], MW = 168, MZ0 = 40, MZ1 = 136, WF = 10, BOX = 12, TD = 46, BU = 56, BZ = 10;
const ZC = (MZ0 + MZ1) / 2, A1 = MW / 2 - BZ, B1 = (MZ1 - MZ0) / 2 - BZ, A2 = A1 - 8, B2 = B1 - 8, GW = WF - 2; // the glass, recessed
const SEQ = [2, 0, 3, 1, 1, 3, 0, 2]; // the slot each card of a lap goes to
const GAP = 34, SLIDE = 22, SINK = 16, SLOW = 0.25, REST = 110;
const XS = -L / 2; // a card's centre when it starts, just inside the console

/** A superellipse a by b round the face's middle: the tube's glass is never a rectangle. */
const squircle = (a, b, n) => Array.from({ length: 48 }, (_, k) => {
  const c = Math.cos((k / 24) * Math.PI), s = Math.sin((k / 24) * Math.PI);
  return { u: a * Math.sign(c) * Math.abs(c) ** (2 / n), v: ZC + b * Math.sign(s) * Math.abs(s) ** (2 / n) };
});

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let speed = value;

  const C = Cam(45, 0.5, 1.3);
  const mon = (u, w, z) => [MC[0] + w, MC[1] - u, z];
  fit(C, [[CON[0], CON[1], 0], [CON[0], CON[3], 0], [BED[2], BED[1], 0], [BED[2], BED[3], 0],
    mon(-MW / 2, WF, MZ1), mon(MW / 2, WF, MZ0), mon(-BU, -TD, MZ1 - 14), mon(MW / 2, WF - BOX, MZ1)], 200, 166);
  const P = proj(C), front = facing(C);
  const W = (u, w, z) => P(...mon(u, w, z));
  const box = (b, z0, z1, r) => { const [o, i] = rings(b[0], b[1], b[2], b[3], r, 1.4); put(solid(g), prism(P, front, o, i, z0, z1)); return o; };

  const g = mk("g", {}, svg);
  // the console, with the belt's mouth on its face
  box(CON, 0, CON[4], 6);
  mk("path", { d: poly([[14, 26], [32, 26], [32, 33], [14, 33]].map(([y, z]) => P(0, y, z))), class: "nf lo" }, g);
  // the bed, then each slot: its far wall, the cards falling in, and the near lip that hides them
  box(BED, 0, BED[4], 5);
  const slots = SLOTS.map((sx) => {
    const ring = rrect(sx - SW / 2, SY0, sx + SW / 2, SY1, 3, 4);
    const far = mk("path", { d: poly(ringAt(P, ring, BED[4])), class: "nf" }, g);
    mk("path", { d: open(ringAt(P, run(ring, (q) => !front(q)), BED[4] - 6)), class: "nf lo" }, g);
    const mid = mk("g", {}, g);
    const near = ringAt(P, run(ring, front), BED[4]);
    mk("path", { d: poly([...near, ...ringAt(P, run(ring, front), BED[4] - SD).reverse()]), class: "fo" }, g);
    const lip = mk("path", { d: open(near), class: "nf" }, g);
    return { mid, far, lip };
  });
  box(BELT.slice(0, 4), BED[4], BELT[4], 3);
  const ribs = mk("path", { class: "nf lo" }, g);
  const off = mk("g", {}, g), on = mk("g", {}, g); // cards leaving the belt, and cards riding it

  // the monitor on a swivel, last: it stands over the bed's far corner. Its screen is bare for the page's words
  box([MC[0] - 34, MC[1] - 30, MC[0], MC[1] + 30], CON[4], MZ0, 6);
  const face = rrect(-MW / 2, MZ0, MW / 2, MZ1, 7, 5), tube = rrect(-BU, MZ0 + 18, BU, MZ1 - 14, 10, 5);
  const flat = (ring, w) => ring.map((q) => W(q.u, w, q.v));
  mk("path", { d: poly(hull([...flat(face, WF), ...flat(face, WF - BOX), ...flat(tube, -TD)])), class: "sil" }, g);
  // the creases: the bezel's top and the side towards us, where it meets the box, and where the box meets the tube
  const top = (ring) => run(ring, (q) => q.nv > 0.2 || q.nu < -0.2);
  mk("path", { d: open(flat(top(face), WF)) + open(flat(top(face), WF - BOX)), class: "nf lo" }, g);
  // the bevel, its four corners running in to the glass
  const bevel = flat(squircle(A1, B1, 7), WF), glass = flat(squircle(A2, B2, 4.5), GW);
  mk("path", { d: poly(bevel), class: "nf" }, g);
  mk("path", { d: [6, 18, 30, 42].map((k) => seg(bevel[k], glass[k])).join(""), class: "nf lo" }, g);
  mk("path", { d: poly(glass), class: "nf" }, g);
  place(mk("circle", { r: 1.1, class: "dot m" }, g), W(MW / 2 - BZ - 4, WF, MZ0 + BZ / 2));

  // eight cards, one per step of the lap, each punched with its slot
  const cards = SEQ.map((s) => {
    const el = solid(g); el.g.remove();
    const dots = SLOTS.map((_, k) => mk("circle", { r: 0.9, class: k === s ? "dot m" : "dot off" }, el.g));
    return { s, el, dots, at: null };
  });
  const land = (s) => SLOTS[s] - XS + SLIDE;
  const life = (s) => land(s) + SINK;

  function card(cd, a) {
    const d1 = SLOTS[cd.s] - XS;
    let cx = XS + Math.min(a, d1), cy = (BELT[1] + BELT[3]) / 2, z = BELT[4], layer = on;
    if (a > d1) {
      const p = EASE_LIFT(clamp((a - d1) / SLIDE, 0, 1)), q = EASE_LIFT(clamp((a - d1 - SLIDE) / SINK, 0, 1));
      cy = lerp(cy, (SY0 + SY1) / 2, p); z = lerp(BELT[4], BED[4] + 1, p) - q * SD;
      layer = q > 0 ? slots[cd.s].mid : off;
    }
    const x0 = Math.max(cx - L / 2, 0.4), x1 = cx + L / 2; // the part still in the console isn't drawn
    if (a > life(cd.s) || x1 - x0 < 1) layer = null;
    if (layer !== cd.at) { layer ? layer.append(cd.el.g) : cd.el.g.remove(); cd.at = layer; }
    if (!layer) return;
    const [o, i] = rings(x0, cy - CW / 2, x1, cy + CW / 2, 2, 1);
    put(cd.el, prism(P, front, o, i, z, z + CT));
    cd.dots.forEach((el, k) => { const x = cx - 6 + k * 4; place(el, x > x0 + 1 ? P(x, cy + 3, z + CT) : [-9, -9]); });
  }

  let dist = REST, act = -1, lit = -1, drawn = -1;
  function draw() {
    if (dist === drawn) return;
    drawn = dist;
    let r = "";
    for (let x = 6 - (dist % 12); x < BELT[2] - 2; x += 12) if (x > 2) r += seg(P(x, BELT[1] + 2, BELT[4]), P(x, BELT[3] - 2, BELT[4]));
    ribs.setAttribute("d", r);
    let last = -Infinity, ls = -1;
    cards.forEach((cd, k) => {
      const j = k + 8 * Math.floor((dist / GAP - k) / 8), a = dist - j * GAP;
      card(cd, a);
      // the slot that took a card last keeps the bright edge
      const t = a >= land(cd.s) ? j * GAP + land(cd.s) : (j - 8) * GAP + land(cd.s);
      if (t > last) { last = t; ls = cd.s; }
    });
    lit = ls;
    shine();
  }
  function shine() {
    const b = act >= 0 ? act : lit;
    slots.forEach((s, i) => { s.lip.classList.toggle("hi", i === b); s.far.classList.toggle("hi", i === b); });
  }

  const rate = spring(1);
  const still = reducedMotion();
  const B = register(stage, (dt) => {
    stepS(rate, dt);
    if (!still) dist += rate.x * speed * dt;
    draw();
    return !still;
  });
  bag.add(B.unregister);

  /** The slot under the pointer, on the bed's top, which never moves; -1 for none. */
  function hit([px, py]) {
    const [x, y] = unproj(C, px, py, BED[4]);
    if (y < SY0 - 4 || y > SY1 + 4) return -1;
    return SLOTS.findIndex((sx) => Math.abs(x - sx) < SW / 2 + 3);
  }
  function setActive(a) {
    if (a !== act) { act = a; read.textContent = a < 0 ? "rest" : `slot ${a + 1}`; shine(); }
    B.wake();
  }
  read.textContent = "rest";
  bag.add(pointer(stage, {
    move: (p) => { rate.t = SLOW; setActive(hit(p)); },
    leave: () => { rate.t = 1; setActive(-1); },
  }));
  bag.add(() => svg.replaceChildren());

  // the text keeps inside the glass's round corners
  const ta = A2 * 0.86, tb = B2 * 0.78;
  const tl = W(-ta, GW, ZC + tb), tr = W(ta, GW, ZC + tb), bl = W(-ta, GW, ZC - tb);
  return {
    set: (v) => { speed = v; },
    destroy: bag.dispose,
    // where the page writes on the screen, in viewBox units: the top-left corner, the width and height
    // of a box standing upright there, and the slope of its top edge in degrees
    screen: [tl[0], tl[1], tr[0] - tl[0], bl[1] - tl[1], (Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * 180) / Math.PI],
  };
}

export default { range: [20, 36, 56], mount };
