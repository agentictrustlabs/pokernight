import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { RoomManifest, RoomPerson } from '@pokernight/protocol';
import type { RoomSocket, RoomState } from '../../lib/roomSocket';

/**
 * THE LOUNGE — the scene (docs/SPATIAL-ROOM.md §3.1, phase 1 steps 1–2).
 *
 * Built-in scenery for now: a felt-green floor, walls, a bar, a fire, tables under lamps on the manifest's
 * anchors, a lectern. Bodies are capsules in a palette with a name plate — a stand-in for the VRM humanoids
 * of step 4, on the same anchors and the same poses. Your body walks with WASD / arrows or a click on the
 * floor; the camera follows from behind and above. Others' bodies ease toward their last pose.
 *
 * The scene draws PRESENCE and nothing else: which table is which comes from the manifest; who is in which
 * chair is a fact the table's own socket will tell the HUD (step 5). Nothing here is money.
 */

const BODY_COLOURS: Record<string, string> = { oak: '#a97c2e', slate: '#4f5d68', brass: '#d9b26a', rose: '#a6392e', moss: '#2f6f52', ink: '#1c2420' };
const FELT = '#1f6b4a';
const WALL = '#143f2c';
const WOOD = '#3b2a1a';
const WALK_SPEED = 3.2; // m/s

export interface LoungeProps {
  socket: RoomSocket;
  state: RoomState;
  /** A body under this table's zone opens the table's HUD; the lounge only reports the zone. */
  onZone?: (zone: string | null) => void;
}

export function Lounge({ socket, state, onZone }: LoungeProps) {
  const manifest = state.manifest;
  useEffect(() => { onZone?.(state.zone); }, [state.zone, onZone]);
  if (!manifest) return <div className="lounge-loading"><p className="hint">Walking in…</p></div>;
  return (
    <div className="lounge">
      <Canvas shadows camera={{ position: [0, 6, -14], fov: 50 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}>
        <color attach="background" args={['#0e2e20']} />
        <fog attach="fog" args={['#0e2e20', 20, 40]} />
        {/* three r155+ lights are physical: a hemisphere of ~2 and a sun of ~2.5 read as a lamp-lit room, not a cave. */}
        <ambientLight intensity={0.6} />
        <hemisphereLight args={['#fff6e0', '#0e2e20', 1.8]} />
        <directionalLight position={[6, 12, -6]} intensity={2.4} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <Scenery manifest={manifest} />
        <People state={state} />
        <You socket={socket} state={state} />
      </Canvas>
      <div className="lounge-help hint">Walk with W A S D or the arrow keys, or click the floor. Walk up to a table to look in.</div>
    </div>
  );
}

// ── the scenery ──
function Scenery({ manifest }: { manifest: RoomManifest }) {
  const a = manifest.anchors;
  return (
    <group>
      {/* the floor: the felt, and the walls of the lounge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow name="floor" userData={{ floor: true }}>
        <planeGeometry args={[22, 22]} />
        <meshStandardMaterial color={FELT} roughness={0.95} />
      </mesh>
      {[[0, 11, 0], [0, -11, 0], [11, 0, Math.PI / 2], [-11, 0, Math.PI / 2]].map(([x, z, ry], i) => (
        <mesh key={i} position={[x as number, 2, z as number]} rotation={[0, ry as number, 0]}>
          <boxGeometry args={[22, 4, 0.3]} />
          <meshStandardMaterial color={WALL} roughness={1} />
        </mesh>
      ))}
      {/* the tables, one per anchor the manifest laid a table on, and a lamp over each */}
      {manifest.tables.map((t) => {
        const p = a[t.anchor]!;
        return (
          <group key={t.tableId} position={[p.x, 0, p.y]}>
            <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[1.5, 1.5, 0.12, 40]} />
              <meshStandardMaterial color="#2a7d58" roughness={0.9} />
            </mesh>
            <mesh position={[0, 0.72, 0]}>
              <cylinderGeometry args={[1.65, 1.65, 0.06, 40]} />
              <meshStandardMaterial color={WOOD} roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <cylinderGeometry args={[0.25, 0.4, 0.72, 16]} />
              <meshStandardMaterial color={WOOD} />
            </mesh>
            {Array.from({ length: t.seats }).map((_, i) => {
              const ang = (i / t.seats) * Math.PI * 2;
              return (
                <mesh key={i} position={[Math.sin(ang) * 2.1, 0.25, Math.cos(ang) * 2.1]} rotation={[0, -ang, 0]} castShadow>
                  <boxGeometry args={[0.5, 0.5, 0.5]} />
                  <meshStandardMaterial color={i < t.seated ? '#8a4034' : '#5b4a86'} roughness={0.8} />
                </mesh>
              );
            })}
            <pointLight position={[0, 3.2, 0]} intensity={40} distance={10} decay={2} color="#fff0cc" />
            <mesh position={[0, 3.4, 0]}>
              <coneGeometry args={[0.6, 0.5, 24, 1, true]} />
              <meshStandardMaterial color="#1c2420" side={THREE.DoubleSide} />
            </mesh>
            <Html position={[0, 1.9, 0]} center distanceFactor={12} className="lounge-plate lounge-plate-table">
              <span>{t.name}</span><small>{t.seated}/{t.seats} seated</small>
            </Html>
          </group>
        );
      })}
      {/* the bar */}
      {a.bar ? (
        <group position={[a.bar.x, 0, a.bar.y]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[1, 1.1, 5]} />
            <meshStandardMaterial color={WOOD} roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.12, 0]}>
            <boxGeometry args={[1.2, 0.06, 5.2]} />
            <meshStandardMaterial color="#d9b26a" metalness={0.5} roughness={0.4} />
          </mesh>
          <Html position={[0, 1.8, 0]} center distanceFactor={12} className="lounge-plate"><span>The bar</span></Html>
        </group>
      ) : null}
      {/* the fire */}
      {a.fire ? (
        <group position={[a.fire.x, 0, a.fire.y]}>
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[0.6, 1.6, 2.2]} />
            <meshStandardMaterial color="#5b4a3a" roughness={1} />
          </mesh>
          <pointLight position={[-0.6, 0.5, 0]} intensity={25} distance={7} decay={2} color="#ff9a3c" />
          <Html position={[0, 1.9, 0]} center distanceFactor={12} className="lounge-plate"><span>The fire</span></Html>
        </group>
      ) : null}
      {/* the lectern — where tonight's guest stands */}
      {a.lectern ? (
        <group position={[a.lectern.x, 0, a.lectern.y]}>
          <mesh position={[0, 0.6, 0]} castShadow>
            <boxGeometry args={[0.5, 1.2, 0.5]} />
            <meshStandardMaterial color={WOOD} />
          </mesh>
          <Html position={[0, 1.7, 0]} center distanceFactor={12} className="lounge-plate"><span>♦ The guest's lectern</span></Html>
        </group>
      ) : null}
    </group>
  );
}

// ── the others ──
function People({ state }: { state: RoomState }) {
  const others = useMemo(() => [...state.people.values()].filter((p) => p.playerId !== state.you), [state.people, state.you]);
  return <>{others.map((p) => <Body key={p.playerId} person={p} />)}</>;
}

/** A body eased toward its last pose — ten poses a second drawn at the display's rate. */
function Body({ person }: { person: RoomPerson }) {
  const group = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3(person.x, 0, person.y));
  const yaw = useRef(person.yaw);
  useEffect(() => { target.current.set(person.x, 0, person.y); yaw.current = person.yaw; }, [person.x, person.y, person.yaw]);
  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    g.position.lerp(target.current, Math.min(1, dt * 8));
    g.rotation.y += (yaw.current - g.rotation.y) * Math.min(1, dt * 8);
  });
  const said = person.said && Date.now() - person.said.at < 8000 ? person.said.text : null;
  return (
    <group ref={group} position={[person.x, 0, person.y]}>
      <Capsule colour={BODY_COLOURS[person.body] ?? '#888'} />
      <Html position={[0, 2.05, 0]} center distanceFactor={10} className="lounge-plate lounge-plate-name">
        <span>{person.name}</span>{person.agent ? <small>{person.agent}</small> : null}
      </Html>
      {said ? <Html position={[0, 2.5, 0]} center distanceFactor={10} className="lounge-bubble"><span>{said}</span></Html> : null}
    </group>
  );
}

function Capsule({ colour }: { colour: string }) {
  return (
    <group>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.32, 1.0, 6, 14]} />
        <meshStandardMaterial color={colour} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.72, 0]} castShadow>
        <sphereGeometry args={[0.26, 18, 14]} />
        <meshStandardMaterial color="#f2e5cb" roughness={0.8} />
      </mesh>
      <mesh position={[0.09, 1.76, 0.22]}><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#1c2420" /></mesh>
      <mesh position={[-0.09, 1.76, 0.22]}><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#1c2420" /></mesh>
    </group>
  );
}

// ── you ──
function You({ socket, state }: { socket: RoomSocket; state: RoomState }) {
  const me = state.you ? state.people.get(state.you) : undefined;
  const group = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(me?.x ?? 0, 0, me?.y ?? -8));
  const yaw = useRef(me?.yaw ?? 0);
  const keys = useRef<Set<string>>(new Set());
  const goal = useRef<THREE.Vector3 | null>(null);
  const { camera, gl, scene } = useThree();
  const [ready, setReady] = useState(false);
  useEffect(() => { if (me && !ready) { pos.current.set(me.x, 0, me.y); yaw.current = me.yaw; setReady(true); } }, [me, ready]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) { keys.current.add(e.key.toLowerCase()); goal.current = null; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  // Click the floor to walk there.
  useEffect(() => {
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const floor = scene.getObjectByName('floor');
      if (!floor) return;
      const hit = ray.intersectObject(floor)[0];
      if (hit) goal.current = new THREE.Vector3(hit.point.x, 0, hit.point.z);
    };
    gl.domElement.addEventListener('click', onClick);
    return () => gl.domElement.removeEventListener('click', onClick);
  }, [gl, camera, scene]);
  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    const k = keys.current;
    let dx = 0, dz = 0;
    if (k.has('w') || k.has('arrowup')) dz += 1;
    if (k.has('s') || k.has('arrowdown')) dz -= 1;
    if (k.has('a') || k.has('arrowleft')) dx -= 1;
    if (k.has('d') || k.has('arrowright')) dx += 1;
    let moved = false;
    if (dx || dz) {
      const len = Math.hypot(dx, dz); dx /= len; dz /= len;
      // Keys are relative to the camera's heading, which trails the body.
      const heading = Math.atan2(camera.position.x - pos.current.x, camera.position.z - pos.current.z) + Math.PI;
      const fx = Math.sin(heading) * dz + Math.cos(heading) * dx;
      const fz = Math.cos(heading) * dz - Math.sin(heading) * dx;
      pos.current.x += fx * WALK_SPEED * dt; pos.current.z += fz * WALK_SPEED * dt;
      yaw.current = Math.atan2(fx, fz);
      moved = true;
    } else if (goal.current) {
      const d = goal.current.clone().sub(pos.current); d.y = 0;
      if (d.length() < 0.1) goal.current = null;
      else { d.normalize(); pos.current.addScaledVector(d, WALK_SPEED * dt); yaw.current = Math.atan2(d.x, d.z); moved = true; }
    }
    pos.current.x = Math.max(-10, Math.min(10, pos.current.x)); pos.current.z = Math.max(-10, Math.min(10, pos.current.z));
    g.position.copy(pos.current);
    g.rotation.y += (yaw.current - g.rotation.y) * Math.min(1, dt * 10);
    if (moved) socket.pose(pos.current.x, pos.current.z, yaw.current);
    // The camera follows from behind and above, easing.
    const behind = new THREE.Vector3(pos.current.x - Math.sin(yaw.current) * 5.5, 4.2, pos.current.z - Math.cos(yaw.current) * 5.5);
    camera.position.lerp(behind, Math.min(1, dt * 2.5));
    camera.lookAt(pos.current.x, 1.2, pos.current.z);
  });
  if (!me) return null;
  return (
    <group ref={group} position={[me.x, 0, me.y]}>
      <Capsule colour={BODY_COLOURS[me.body] ?? '#888'} />
      <Html position={[0, 2.05, 0]} center distanceFactor={10} className="lounge-plate lounge-plate-name lounge-plate-you"><span>{me.name} · you</span></Html>
    </group>
  );
}
