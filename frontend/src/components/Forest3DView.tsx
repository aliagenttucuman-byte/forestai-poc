import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, Sky, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useForestStore, type DetectedTree } from '../store/useForestStore'

const HEALTH_COLORS: Record<string, string> = {
  sano: '#22c55e',
  estresado: '#eab308',
  muerto: '#ef4444',
  unknown: '#94a3b8',
}

type TreeData = DetectedTree

function Tree({ tree, onClick, selected }: {
  tree: TreeData
  onClick: (t: TreeData) => void
  selected: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const color = HEALTH_COLORS[tree.health_status] || HEALTH_COLORS.unknown
  const height = tree.crown_diameter * 1.5 + 1
  const radius = tree.crown_diameter / 2

  useFrame((state) => {
    if (meshRef.current && selected) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.5
    }
  })

  return (
    <group position={[tree.x, 0, tree.y]}>
      <mesh position={[0, height / 4, 0]}>
        <cylinderGeometry args={[0.08, 0.12, height / 2, 8]} />
        <meshStandardMaterial color="#7c5c3a" roughness={0.9} />
      </mesh>
      <mesh
        ref={meshRef}
        position={[0, height / 2 + height / 4, 0]}
        onClick={() => onClick(tree)}
      >
        <sphereGeometry args={[radius, 12, 12]} />
        <meshStandardMaterial
          color={color}
          roughness={0.7}
          metalness={selected ? 0.4 : 0}
          emissive={selected ? color : '#000000'}
          emissiveIntensity={selected ? 0.3 : 0}
        />
      </mesh>
      {selected && (
        <Html position={[0, height + 1.5, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.85)', color: 'white',
            padding: '6px 10px', borderRadius: 8, fontSize: 11,
            whiteSpace: 'nowrap', border: `1px solid ${color}`,
            boxShadow: `0 0 8px ${color}`,
          }}>
            <div style={{ color, fontWeight: 'bold' }}>🌳 {tree.id}</div>
            <div>Estado: <b>{tree.health_status}</b></div>
            <div>Copa: {tree.crown_diameter.toFixed(1)}m</div>
            {tree.species && <div>Especie: {tree.species}</div>}
            {tree.vlm_health && <div>VLM: {tree.vlm_health}</div>}
            {tree.score !== undefined && <div>Score: {(tree.score * 100).toFixed(0)}%</div>}
          </div>
        </Html>
      )}
    </group>
  )
}

function Terrain({ size }: { size: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[size / 2, -0.1, size / 2]}>
      <planeGeometry args={[size + 20, size + 20, 20, 20]} />
      <meshStandardMaterial color="#4a7c59" roughness={1} />
    </mesh>
  )
}

export default function Forest3DView() {
  const [selected, setSelected] = useState<TreeData | null>(null)
  const [filter, setFilter] = useState<string>('todos')
  const detectedTrees = useForestStore((s) => s.detectedTrees)
  const hasTrees = detectedTrees.length > 0

  const counts = {
    sano:      detectedTrees.filter(t => t.health_status === 'sano').length,
    estresado: detectedTrees.filter(t => t.health_status === 'estresado').length,
    muerto:    detectedTrees.filter(t => t.health_status === 'muerto').length,
    unknown:   detectedTrees.filter(t => t.health_status === 'unknown').length,
  }

  const filtered = filter === 'todos'
    ? detectedTrees
    : detectedTrees.filter(t => t.health_status === filter)

  return (
    <div style={{ width: '100%', height: '100vh', background: '#0f172a', position: 'relative' }}>

      {/* HUD */}
      <div style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10,
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          border: '1px solid #22c55e33', borderRadius: 12, padding: '8px 20px',
          color: 'white', fontFamily: 'monospace', fontSize: 13,
        }}>
          🛰️ <b>ForestAI</b> — Vista 3D
          {hasTrees
            ? <span style={{ color: '#22c55e', marginLeft: 8 }}>● {detectedTrees.length} árboles detectados</span>
            : <span style={{ color: '#f59e0b', marginLeft: 8 }}>⚠ Ejecutá una detección primero</span>
          }
        </div>
      </div>

      {/* Sin detección */}
      {!hasTrees && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10, textAlign: 'center', color: 'white', fontFamily: 'monospace',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌲</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No hay detección activa</div>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>
            Andá a <b>🌲 Detección</b>, ejecutá el análisis<br/>
            y volvé acá para ver los árboles en 3D
          </div>
        </div>
      )}

      {/* Stats */}
      {hasTrees && (
        <div style={{
          position: 'absolute', top: 70, left: 16, zIndex: 10,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
          border: '1px solid #334155', borderRadius: 12, padding: '14px 18px',
          color: 'white', fontFamily: 'monospace', fontSize: 12, minWidth: 180,
        }}>
          <div style={{ color: '#94a3b8', marginBottom: 8, fontSize: 11 }}>DETECCIÓN ACTIVA</div>
          <div style={{ marginBottom: 4 }}>Total: <b style={{ color: '#60a5fa' }}>{detectedTrees.length}</b></div>
          <div style={{ marginBottom: 4 }}>🟢 Sanos: <b style={{ color: '#22c55e' }}>{counts.sano}</b></div>
          <div style={{ marginBottom: 4 }}>🟡 Estresados: <b style={{ color: '#eab308' }}>{counts.estresado}</b></div>
          <div style={{ marginBottom: 4 }}>🔴 Muertos: <b style={{ color: '#ef4444' }}>{counts.muerto}</b></div>
          <div style={{ marginBottom: 12 }}>⚪ Sin clasificar: <b style={{ color: '#94a3b8' }}>{counts.unknown}</b></div>
          <div style={{ color: '#94a3b8', marginBottom: 6, fontSize: 11 }}>FILTRAR</div>
          {(['todos', 'sano', 'estresado', 'muerto', 'unknown'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              display: 'block', width: '100%', marginBottom: 4,
              padding: '4px 10px', borderRadius: 6, border: 'none',
              background: filter === f ? '#1e40af' : '#1e293b',
              color: filter === f ? 'white' : '#94a3b8',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 11,
            }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'todos' && ` (${counts[f as keyof typeof counts] ?? 0})`}
            </button>
          ))}
        </div>
      )}

      {/* Árbol seleccionado */}
      {selected && (
        <div style={{
          position: 'absolute', top: 70, right: 16, zIndex: 10,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
          border: `1px solid ${HEALTH_COLORS[selected.health_status]}`,
          borderRadius: 12, padding: '14px 18px',
          color: 'white', fontFamily: 'monospace', fontSize: 12, minWidth: 200,
          boxShadow: `0 0 20px ${HEALTH_COLORS[selected.health_status]}44`,
        }}>
          <div style={{ color: '#94a3b8', marginBottom: 8, fontSize: 11 }}>ÁRBOL SELECCIONADO</div>
          <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8,
            color: HEALTH_COLORS[selected.health_status] }}>
            🌳 {selected.id}
          </div>
          <div>Estado: <b>{selected.health_status}</b></div>
          <div>Copa: <b>{selected.crown_diameter.toFixed(2)}m</b></div>
          {selected.species && <div>Especie: <b>{selected.species}</b></div>}
          {selected.vlm_health && <div>VLM: <b>{selected.vlm_health}</b></div>}
          {selected.score !== undefined && <div>Score: <b>{(selected.score * 100).toFixed(0)}%</b></div>}
          <button onClick={() => setSelected(null)} style={{
            marginTop: 10, padding: '4px 12px', borderRadius: 6,
            border: '1px solid #475569', background: 'transparent',
            color: '#94a3b8', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11,
          }}>✕ Cerrar</button>
        </div>
      )}

      {/* Leyenda */}
      {hasTrees && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, display: 'flex', gap: 16,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          border: '1px solid #334155', borderRadius: 10, padding: '8px 20px',
          color: 'white', fontFamily: 'monospace', fontSize: 11,
        }}>
          <span>🖱️ Click = seleccionar</span>
          <span>|</span>
          <span>🔄 Drag = rotar</span>
          <span>|</span>
          <span>🔍 Scroll = zoom</span>
        </div>
      )}

      {/* Canvas */}
      <Canvas camera={{ position: [30, 35, 60], fov: 50 }} shadows>
        <Sky sunPosition={[100, 20, 100]} />
        <Stars radius={200} depth={50} count={3000} factor={4} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[50, 80, 30]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]} />
        {hasTrees && <Terrain size={60} />}
        {filtered.map(tree => (
          <Tree key={tree.id} tree={tree} onClick={setSelected} selected={selected?.id === tree.id} />
        ))}
        <OrbitControls enablePan enableZoom minDistance={5} maxDistance={120} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
    </div>
  )
}
