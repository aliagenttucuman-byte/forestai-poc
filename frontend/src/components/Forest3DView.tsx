import { useRef, useState, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, Sky, Stars, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { type DetectionResult, type TreeBox } from './TreeDetectionPanel'

// Colores por salud (VLM) o score (DeepForest fallback)
function getHealthColor(tree: TreeBox): string {
  if (tree.vlm_health) {
    const map: Record<string, string> = {
      saludable: '#22c55e',
      estresado: '#eab308',
      enfermo: '#ef4444',
      muerto: '#7f1d1d',
    }
    return map[tree.vlm_health] || '#94a3b8'
  }
  // Fallback por score DeepForest
  if (tree.score > 0.7) return '#22c55e'
  if (tree.score > 0.5) return '#eab308'
  return '#94a3b8'
}

interface Tree3D {
  id: string
  x: number
  z: number
  crownRadius: number
  height: number
  color: string
  raw: TreeBox
}

function treeBoxTo3D(tree: TreeBox, idx: number, imgW: number, imgH: number, sceneSize: number): Tree3D {
  // Normalizar por la misma dimensión para preservar aspect ratio
  const maxDim = Math.max(imgW, imgH)
  const cx = ((tree.xmin + tree.xmax) / 2 / maxDim) * sceneSize
  const cz = ((tree.ymin + tree.ymax) / 2 / maxDim) * sceneSize
  const bboxW = (tree.xmax - tree.xmin) / maxDim * sceneSize
  const bboxH = (tree.ymax - tree.ymin) / maxDim * sceneSize
  const crownRadius = Math.max(0.4, Math.min(3.5, (bboxW + bboxH) / 4))
  const height = crownRadius * 2.5 + 0.8
  return {
    id: `ARB-${String(idx + 1).padStart(3, '0')}`,
    x: cx,
    z: cz,
    crownRadius,
    height,
    color: getHealthColor(tree),
    raw: tree,
  }
}

// ─── Árbol 3D ────────────────────────────────────────────────────────────────
function Tree3D({ tree, selected, onClick }: {
  tree: Tree3D
  selected: boolean
  onClick: () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (meshRef.current && selected) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.6
    }
  })

  const trunkH = tree.height * 0.35
  const crownY = trunkH + tree.crownRadius * 0.9

  return (
    <group position={[tree.x, 0, tree.z]} onClick={(e) => { e.stopPropagation(); onClick() }}>
      {/* Tronco */}
      <mesh position={[0, trunkH / 2, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.14, trunkH, 8]} />
        <meshStandardMaterial color="#7c5c3a" roughness={0.9} />
      </mesh>
      {/* Copa */}
      <mesh ref={meshRef} position={[0, crownY, 0]} castShadow receiveShadow>
        <sphereGeometry args={[tree.crownRadius, 14, 14]} />
        <meshStandardMaterial
          color={tree.color}
          roughness={0.65}
          metalness={selected ? 0.35 : 0.05}
          emissive={selected ? tree.color : '#000000'}
          emissiveIntensity={selected ? 0.4 : 0}
        />
      </mesh>
      {/* Anillo selección */}
      {selected && (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[tree.crownRadius + 0.3, tree.crownRadius + 0.6, 32]} />
          <meshStandardMaterial color={tree.color} emissive={tree.color} emissiveIntensity={0.8} transparent opacity={0.8} />
        </mesh>
      )}
      {/* Tooltip */}
      {selected && (
        <Html position={[0, crownY + tree.crownRadius + 1.2, 0]} center>
          <div style={{
            background: 'rgba(0,0,0,0.88)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: 10,
            fontSize: 11,
            whiteSpace: 'nowrap',
            border: `1.5px solid ${tree.color}`,
            boxShadow: `0 0 12px ${tree.color}88`,
            pointerEvents: 'none',
            lineHeight: 1.6,
          }}>
            <div style={{ color: tree.color, fontWeight: 700, marginBottom: 4 }}>🌳 {tree.id}</div>
            <div>Score: <b>{(tree.raw.score * 100).toFixed(1)}%</b></div>
            {tree.raw.sam_score != null && <div>SAM: <b>{(tree.raw.sam_score * 100).toFixed(1)}%</b></div>}
            {tree.raw.vlm_species && <div>Especie: <b>{tree.raw.vlm_species}</b></div>}
            {tree.raw.vlm_health && <div style={{ color: tree.color }}>Salud: <b>{tree.raw.vlm_health}</b></div>}
            <div style={{ color: '#94a3b8', fontSize: 10 }}>
              Copa: {(tree.crownRadius * 2).toFixed(1)}u · Alt: {tree.height.toFixed(1)}u
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

// ─── Terreno con ortofoto ────────────────────────────────────────────────────
function Terrain({ sceneW, sceneH, imageB64 }: { sceneW: number; sceneH: number; imageB64?: string }) {
  const texture = useMemo(() => {
    if (!imageB64) return null
    const tex = new THREE.TextureLoader().load(`data:image/png;base64,${imageB64}`)
    tex.flipY = false
    return tex
  }, [imageB64])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sceneW / 2, -0.05, sceneH / 2]} receiveShadow>
      <planeGeometry args={[sceneW, sceneH, 1, 1]} />
      <meshStandardMaterial
        map={texture || undefined}
        color={texture ? '#ffffff' : '#3d6b4f'}
        roughness={1}
      />
    </mesh>
  )
}

// ─── Escena vacía (sin detección aún) ───────────────────────────────────────
function EmptyScene({ onGoDetect }: { onGoDetect: () => void }) {
  return (
    <div style={{
      width: '100%', height: '100%', background: '#0f172a',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 20, fontFamily: 'monospace',
    }}>
      <div style={{ fontSize: 64 }}>🌲</div>
      <p style={{ color: '#94a3b8', fontSize: 16, margin: 0 }}>
        No hay árboles detectados aún
      </p>
      <p style={{ color: '#475569', fontSize: 13, margin: 0, textAlign: 'center' }}>
        Corré la detección primero y volvé acá<br />para ver el bosque en 3D con datos reales
      </p>
      <button
        onClick={onGoDetect}
        style={{
          marginTop: 8, padding: '12px 28px', borderRadius: 12, border: 'none',
          background: 'linear-gradient(135deg, #059669, #10b981)',
          color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}
      >
        ▶ Ir a Detección IA
      </button>
    </div>
  )
}

// ─── Vista 3D principal ──────────────────────────────────────────────────────
export default function Forest3DView({
  detectionResult,
  onGoDetect,
}: {
  detectionResult?: DetectionResult | null
  onGoDetect?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'todos' | 'saludable' | 'estresado' | 'enfermo'>('todos')

  const SCENE_SIZE = 80

  // Dimensiones de escena preservando aspect ratio de la imagen
  const imgW = detectionResult?.image_width || 1
  const imgH = detectionResult?.image_height || 1
  const maxDim = Math.max(imgW, imgH)
  const sceneW = (imgW / maxDim) * SCENE_SIZE
  const sceneH = (imgH / maxDim) * SCENE_SIZE

  const trees3D = useMemo<Tree3D[]>(() => {
    if (!detectionResult?.trees.length) return []
    return detectionResult.trees.map((t, i) =>
      treeBoxTo3D(t, i, detectionResult.image_width, detectionResult.image_height, SCENE_SIZE)
    )
  }, [detectionResult])

  const filteredTrees = useMemo(() => {
    if (filter === 'todos') return trees3D
    return trees3D.filter(t => t.raw.vlm_health === filter)
  }, [trees3D, filter])

  const hasVLM = trees3D.some(t => t.raw.vlm_health)

  const counts = useMemo(() => ({
    total: trees3D.length,
    saludable: trees3D.filter(t => t.raw.vlm_health === 'saludable').length,
    estresado: trees3D.filter(t => t.raw.vlm_health === 'estresado').length,
    enfermo: trees3D.filter(t => t.raw.vlm_health === 'enfermo').length,
    highConf: trees3D.filter(t => t.raw.score > 0.7).length,
    samUsed: trees3D.filter(t => t.raw.polygon && t.raw.polygon.length > 0).length,
  }), [trees3D])

  const selectedTree = trees3D.find(t => t.id === selectedId) || null

  if (!detectionResult || trees3D.length === 0) {
    return <EmptyScene onGoDetect={onGoDetect || (() => {})} />
  }

  return (
    <div style={{ width: '100%', height: '100%', background: '#0f172a', position: 'relative', display: 'flex' }}>

      {/* ── CSS ── */}
      <style>{`@keyframes spin3d { to { transform: rotate(360deg); } }`}</style>

      {/* ── HUD superior ── */}
      <div style={{
        position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
          border: '1px solid #22c55e44', borderRadius: 12, padding: '7px 18px',
          color: 'white', fontFamily: 'monospace', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span>🛰️ <b>ForestAI 3D</b></span>
          <span style={{ color: '#475569' }}>|</span>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>{detectionResult.sample_name}</span>
          {detectionResult.sam_used && (
            <span style={{ background: '#059669', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>SAM</span>
          )}
          {detectionResult.vlm_used && (
            <span style={{ background: '#7c3aed', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>VLM</span>
          )}
        </div>
      </div>

      {/* ── Panel izquierdo — stats + filtros ── */}
      <div style={{
        position: 'absolute', top: 60, left: 14, zIndex: 10,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
        border: '1px solid #1e293b', borderRadius: 14, padding: '16px 18px',
        color: 'white', fontFamily: 'monospace', fontSize: 12, minWidth: 190,
      }}>
        <div style={{ color: '#64748b', marginBottom: 10, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Parcela detectada
        </div>

        {[
          { label: 'Total árboles', value: counts.total, color: '#60a5fa' },
          { label: 'Alta confianza', value: counts.highConf, color: '#22c55e' },
          { label: 'Segmentados SAM', value: counts.samUsed, color: '#a78bfa' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: '#94a3b8' }}>{label}</span>
            <b style={{ color }}>{value}</b>
          </div>
        ))}

        {hasVLM && (
          <>
            <div style={{ borderTop: '1px solid #1e293b', margin: '10px 0' }} />
            <div style={{ color: '#64748b', marginBottom: 8, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Salud (VLM)
            </div>
            {[
              { label: '🟢 Saludable', value: counts.saludable, color: '#22c55e' },
              { label: '🟡 Estresado', value: counts.estresado, color: '#eab308' },
              { label: '🔴 Enfermo', value: counts.enfermo, color: '#ef4444' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span>{label}</span>
                <b style={{ color }}>{value}</b>
              </div>
            ))}

            <div style={{ borderTop: '1px solid #1e293b', margin: '10px 0' }} />
            <div style={{ color: '#64748b', marginBottom: 6, fontSize: 10, textTransform: 'uppercase' }}>Filtrar</div>
            {(['todos', 'saludable', 'estresado', 'enfermo'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                display: 'block', width: '100%', marginBottom: 4,
                padding: '4px 10px', borderRadius: 6, border: 'none',
                background: filter === f ? '#1e40af' : '#1e293b',
                color: filter === f ? 'white' : '#94a3b8',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 11,
              }}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </>
        )}
      </div>

      {/* ── Panel derecho — árbol seleccionado ── */}
      {selectedTree && (
        <div style={{
          position: 'absolute', top: 60, right: 14, zIndex: 10,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          border: `1.5px solid ${selectedTree.color}`,
          borderRadius: 14, padding: '14px 18px',
          color: 'white', fontFamily: 'monospace', fontSize: 12, minWidth: 210,
          boxShadow: `0 0 24px ${selectedTree.color}44`,
        }}>
          <div style={{ color: '#64748b', marginBottom: 8, fontSize: 10, textTransform: 'uppercase' }}>Árbol seleccionado</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: selectedTree.color, marginBottom: 10 }}>
            🌳 {selectedTree.id}
          </div>
          {[
            { label: 'DeepForest', value: `${(selectedTree.raw.score * 100).toFixed(1)}%` },
            ...(selectedTree.raw.sam_score != null ? [{ label: 'SAM score', value: `${(selectedTree.raw.sam_score * 100).toFixed(1)}%` }] : []),
            ...(selectedTree.raw.polygon?.length ? [{ label: 'Polígono', value: `${selectedTree.raw.polygon.length} pts` }] : []),
            ...(selectedTree.raw.vlm_species ? [{ label: 'Especie', value: selectedTree.raw.vlm_species }] : []),
            ...(selectedTree.raw.vlm_health ? [{ label: 'Salud', value: selectedTree.raw.vlm_health }] : []),
            { label: 'Corona', value: `${(selectedTree.crownRadius * 2).toFixed(1)} u` },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ color: '#94a3b8' }}>{label}</span>
              <b>{value}</b>
            </div>
          ))}
          <button onClick={() => setSelectedId(null)} style={{
            marginTop: 10, width: '100%', padding: '5px 0', borderRadius: 8,
            border: '1px solid #334155', background: 'transparent',
            color: '#94a3b8', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11,
          }}>✕ Cerrar</button>
        </div>
      )}

      {/* ── Leyenda inferior ── */}
      <div style={{
        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, display: 'flex', gap: 16,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        border: '1px solid #1e293b', borderRadius: 10, padding: '7px 20px',
        color: '#94a3b8', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap',
      }}>
        <span>🖱️ Click = seleccionar</span>
        <span>|</span>
        <span>🔄 Drag = rotar</span>
        <span>|</span>
        <span>🔍 Scroll = zoom</span>
        <span>|</span>
        <span style={{ color: '#22c55e' }}>■</span> Alta conf
        <span style={{ color: '#eab308' }}>■</span> Media
        <span style={{ color: '#94a3b8' }}>■</span> Baja
      </div>

      {/* ── Canvas Three.js ── */}
      <Canvas camera={{ position: [sceneW * 0.6, sceneW * 0.7, sceneH * 0.8], fov: 45 }} shadows>
        <Sky sunPosition={[100, 30, 100]} turbidity={8} rayleigh={2} />
        <Stars radius={300} depth={60} count={2000} factor={3} />
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[sceneW, sceneW * 1.5, sceneH * 0.5]}
          intensity={1.4}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />

        {/* Terreno con ortofoto como textura, mismo aspect ratio que la imagen */}
        <Terrain sceneW={sceneW} sceneH={sceneH} imageB64={detectionResult.annotated_image_b64} />

        {/* Grid sutil */}
        <Grid
          position={[sceneW / 2, 0, sceneH / 2]}
          args={[sceneW, sceneH]}
          cellSize={5}
          cellThickness={0.4}
          cellColor="#1e293b"
          sectionSize={20}
          sectionThickness={0.8}
          sectionColor="#334155"
          fadeDistance={200}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
        />

        {filteredTrees.map(tree => (
          <Tree3D
            key={tree.id}
            tree={tree}
            selected={tree.id === selectedId}
            onClick={() => setSelectedId(tree.id === selectedId ? null : tree.id)}
          />
        ))}

        <OrbitControls
          target={[sceneW / 2, 0, sceneH / 2]}
          enablePan
          enableZoom
          minDistance={5}
          maxDistance={300}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
    </div>
  )
}
