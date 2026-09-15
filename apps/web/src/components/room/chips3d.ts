/**
 * CHIPS ON THE FELT, as geometry (spec §5.5). A chip is a short cylinder in a denomination colour; a bet or a
 * stack is a pile of them. The count is broken into denominations (biggest first) so a big stack is a few tall
 * columns, not a thousand discs. Materials are made once per colour and shared.
 */
import * as pc from 'playcanvas';

const DENOMS: Array<{ v: number; c: [number, number, number] }> = [
  // colours chosen to READ ON GREEN FELT from a chair, not the casino's — a black 100 vanished on the felt
  { v: 1000, c: [0.95, 0.6, 0.12] },  // orange
  { v: 500, c: [0.55, 0.28, 0.7] },   // purple
  { v: 100, c: [0.16, 0.36, 0.85] },  // blue
  { v: 25, c: [0.95, 0.85, 0.2] },    // yellow
  { v: 5, c: [0.85, 0.16, 0.16] },    // red
  { v: 1, c: [0.95, 0.95, 0.93] },    // white
];
const CHIP_H = 0.013, CHIP_R = 0.04; // oversized like the cards: a stack must read from across the felt

export class Chips3D {
  private mats = new Map<number, pc.StandardMaterial>();
  private edge: pc.StandardMaterial;
  constructor(private readonly app: pc.Application) {
    this.edge = new pc.StandardMaterial(); this.edge.diffuse = new pc.Color(0.95, 0.95, 0.93); this.edge.update();
    for (const d of DENOMS) { const m = new pc.StandardMaterial(); m.diffuse = new pc.Color(...d.c); m.gloss = 0.4; m.update(); this.mats.set(d.v, m); }
  }
  /** Break `amount` into denomination counts, biggest first, capped so a pile never runs away. */
  private breakdown(amount: number): Array<{ v: number; n: number }> {
    let left = Math.max(0, Math.round(amount)); const out: Array<{ v: number; n: number }> = [];
    for (const d of DENOMS) { if (left < d.v) continue; let n = Math.floor(left / d.v); left -= n * d.v; n = Math.min(n, 12); if (n > 0) out.push({ v: d.v, n }); }
    return out;
  }
  /**
   * A pile of `amount` at (x, z) on the felt (top at y), as columns side by side. Returns the parent entity and
   * the world position of the TOP chip (where a thrown chip would leave from).
   */
  pile(amount: number, x: number, y: number, z: number, parent: pc.Entity, spread = 0.045): { entity: pc.Entity; top: pc.Vec3 } {
    const g = new pc.Entity('chips'); g.setLocalPosition(x, y, z); parent.addChild(g);
    const cols = this.breakdown(amount); let cx = -(cols.length - 1) * spread / 2; let topY = y;
    for (const col of cols) {
      for (let i = 0; i < col.n; i++) {
        const e = new pc.Entity('chip'); e.addComponent('render', { type: 'cylinder', material: this.mats.get(col.v)!, castShadows: true });
        e.setLocalScale(CHIP_R * 2, CHIP_H, CHIP_R * 2); e.setLocalPosition(cx, i * CHIP_H + CHIP_H / 2, 0); g.addChild(e);
      }
      topY = Math.max(topY, y + col.n * CHIP_H); cx += spread;
    }
    return { entity: g, top: new pc.Vec3(x, topY + 0.01, z) };
  }
}
