/**
 * CARDS ON THE FELT, as geometry (spec §5.5). A deck is one texture — 52 faces and a back, drawn once on a
 * canvas with the 2D API (rank, pips, a rounded white face; the back in the room's green) — and a card is a
 * unit plane scaled to a real card (63 × 88 mm) with a material that windows onto its face by UV offset. One
 * material per face, made when first asked for and kept; a face-down card is the back. Flat on the felt,
 * turned to the seat that owns it, so from any chair the cards lie the way cards lie.
 */
import * as pc from 'playcanvas';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];
const GLYPH: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const COLS = 13, ROWS = 5; // 4 suits + the back row
const CW = 256, CH = 358; // a cell per card, sharp when the camera leans in

export class Deck3D {
  private texture: pc.Texture;
  private materials = new Map<string, pc.StandardMaterial>();
  constructor(private readonly app: pc.Application) {
    const c = document.createElement('canvas'); c.width = CW * COLS; c.height = CH * ROWS;
    const g = c.getContext('2d')!;
    const face = (x: number, y: number) => { g.fillStyle = '#fffdf7'; round(g, x + 6, y + 6, CW - 12, CH - 12, 20); g.fill(); g.strokeStyle = '#c9c4b6'; g.lineWidth = 4; g.stroke(); };
    SUITS.forEach((s, r) => RANKS.forEach((rank, i) => {
      const x = i * CW, y = r * CH; face(x, y);
      const red = s === 'd' || s === 'h'; g.fillStyle = red ? '#b8262b' : '#1c2420';
      const label = rank === 'T' ? '10' : rank;
      g.font = 'bold 68px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(label, x + 22, y + 18); g.font = '58px serif'; g.fillText(GLYPH[s]!, x + 22, y + 92);
      g.save(); g.translate(x + CW - 22, y + CH - 18); g.rotate(Math.PI); g.font = 'bold 68px "IBM Plex Sans", system-ui, sans-serif'; g.fillText(label, 0, 0); g.font = '58px serif'; g.fillText(GLYPH[s]!, 0, 74); g.restore();
      g.font = '150px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(GLYPH[s]!, x + CW / 2, y + CH / 2 + 12);
    }));
    // the back: the room's green with a brass border and a diamond lattice
    const bx = 0, by = 4 * CH; face(bx, by);
    g.fillStyle = '#1f6a49'; round(g, bx + 20, by + 20, CW - 40, CH - 40, 12); g.fill(); g.strokeStyle = '#d9b26a'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = 'rgba(217,178,106,0.35)'; g.lineWidth = 1.5;
    for (let d = -CH; d < CW + CH; d += 32) { g.beginPath(); g.moveTo(bx + d, by + 24); g.lineTo(bx + d + CH, by + CH - 24); g.stroke(); g.beginPath(); g.moveTo(bx + d, by + CH - 24); g.lineTo(bx + d + CH, by + 24); g.stroke(); }
    this.texture = new pc.Texture(app.graphicsDevice, { width: c.width, height: c.height, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, anisotropy: 16, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
    this.texture.setSource(c);
  }
  /** The material that shows `code` (`As`, `Td`, …) or the back when there is no code. */
  material(code: string | null): pc.StandardMaterial {
    const key = code ?? 'back';
    let m = this.materials.get(key);
    if (m) return m;
    m = new pc.StandardMaterial();
    m.diffuseMap = this.texture; m.useMetalness = true; m.metalness = 0; m.gloss = 0.35;
    let col = 0, row = 4;
    if (code) { col = RANKS.indexOf(code[0]!); row = SUITS.indexOf(code[1]!); if (col < 0 || row < 0) { col = 0; row = 4; } }
    // a plane's UVs run 0..1; the window is one cell of the atlas (V runs bottom-up, so the row is flipped)
    m.diffuseMapTiling = new pc.Vec2(1 / COLS, 1 / ROWS);
    m.diffuseMapOffset = new pc.Vec2(col / COLS, (ROWS - 1 - row) / ROWS);
    m.update();
    this.materials.set(key, m);
    return m;
  }
  /** A card lying on the felt at (x, H, z), its top edge pointing `yaw` — the way the seat's owner reads it. */
  card(code: string | null, x: number, y: number, z: number, yaw: number, parent: pc.Entity, lift = 0): pc.Entity {
    const e = new pc.Entity('card');
    e.addComponent('render', { type: 'plane', material: this.material(code), castShadows: false, receiveShadows: false });
    e.setLocalScale(0.063 * 4.4, 1, 0.088 * 4.4); // oversized on purpose: a card must read from the far side of the felt
    e.setLocalPosition(x, y + lift, z); e.setLocalEulerAngles(0, yaw * 180 / Math.PI, 0);
    parent.addChild(e);
    return e;
  }
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
