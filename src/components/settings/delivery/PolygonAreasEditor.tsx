import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polygon, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Undo2 } from 'lucide-react'
import { loadGoogleMaps } from '@/lib/googleMapsLoader'
import { formatBRL } from '@/lib/currency'

export type PolygonPoint = { lat: number; lng: number }

export type PolygonAreaDraft = {
  id: string
  name: string
  delivery_fee: string
  minimum_order: string
  delivery_time: string
  active: boolean
  points: PolygonPoint[]
}

function makeId() {
  try {
    const c = crypto as unknown as { randomUUID?: () => string }
    if (typeof c?.randomUUID === 'function') return c.randomUUID()
  } catch {}
  return String(Date.now()) + '-' + Math.random().toString(16).slice(2)
}

function MapClickAdder(props: { enabled: boolean; onAdd: (p: PolygonPoint) => void }) {
  useMapEvents({
    click: (e) => {
      if (!props.enabled) return
      props.onAdd({ lat: e.latlng.lat, lng: e.latlng.lng })
    }
  })
  return null
}

function LeafletAutoResize() {
  const map = useMap()
  useEffect(() => {
    const t1 = window.setTimeout(() => map.invalidateSize(), 50)
    const t2 = window.setTimeout(() => map.invalidateSize(), 250)
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.invalidateSize()
          })
        : null
    try {
      const el = map.getContainer()
      ro?.observe(el)
      if (el.parentElement) ro?.observe(el.parentElement)
    } catch {}
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [map])
  return null
}

export { loadGoogleMaps }

export function GooglePolygonMap(props: {
  center: { lat: number; lng: number }
  enabled: boolean
  points: PolygonPoint[]
  onAddPoint: (p: PolygonPoint) => void
  storeLocation?: { lat: number; lng: number } | null
  onStoreLocationChange?: (p: PolygonPoint) => void
  radiusMeters?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const polygonRef = useRef<google.maps.Polygon | null>(null)
  const radiusRef = useRef<google.maps.Circle | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const enabledRef = useRef<boolean>(props.enabled)
  const [mapInitializationError, setMapInitializationError] = useState('')
  enabledRef.current = props.enabled

  const [isDrawing, setIsDrawing] = useState(props.points.length < 3)
  const isDrawingRef = useRef(isDrawing)
  isDrawingRef.current = isDrawing

  // Se a área for limpa, volta ao modo de desenho
  useEffect(() => {
    if (props.points.length === 0) {
      setIsDrawing(true)
    }
  }, [props.points.length])

  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return
    const maps = window.google?.maps
    if (!maps?.Map || !maps?.Polygon || !maps?.Circle) return

    try {
      mapRef.current = new maps.Map(containerRef.current, {
        center: props.center,
        zoom: 14,
        mapTypeId: maps.MapTypeId?.ROADMAP || 'roadmap',
        streetViewControl: false,
        fullscreenControl: false
      })

      polygonRef.current = new maps.Polygon({
        paths: [],
        strokeColor: '#f97316',
        strokeOpacity: 1,
        strokeWeight: 2,
        fillColor: '#f97316',
        fillOpacity: 0.15,
        clickable: false
      })
      polygonRef.current.setMap(mapRef.current)

      if (props.radiusMeters !== undefined) {
        radiusRef.current = new maps.Circle({
          strokeColor: '#f97316',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#f97316',
          fillOpacity: 0.15,
          map: mapRef.current,
          center: props.center,
          radius: props.radiusMeters,
          clickable: false
        })
      }

      mapRef.current.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!enabledRef.current || !isDrawingRef.current) return
        const lat = e.latLng?.lat()
        const lng = e.latLng?.lng()
        if (typeof lat !== 'number' || typeof lng !== 'number') return
        onAddPointRef.current({ lat, lng })
      })
      setMapInitializationError('')
    } catch (error) {
      console.error('[GooglePolygonMap] Falha ao inicializar o mapa', error)
      setMapInitializationError('Não foi possível abrir o mapa agora. Recarregue a página para tentar novamente.')
    }
  }, [props.center])

  // Update refs when props change without recreating the map/listeners
  useEffect(() => {
    enabledRef.current = props.enabled
  }, [props.enabled])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.setCenter(props.center)
  }, [props.center])

  useEffect(() => {
    if (!mapRef.current) return
    const g = window.google
    if (!g?.maps) return
    const triggerResize = () => {
      if (!mapRef.current) return
      g.maps.event.trigger(mapRef.current, 'resize')
      mapRef.current.setCenter(props.center)
    }
    
    const t1 = window.setTimeout(triggerResize, 50)
    const t2 = window.setTimeout(triggerResize, 250)
    const ro =
      typeof ResizeObserver !== 'undefined' && containerRef.current
        ? new ResizeObserver(triggerResize)
        : null
    if (ro && containerRef.current) ro.observe(containerRef.current)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      ro?.disconnect()
    }
  }, [props.center, props.enabled])

  // Need to use latest onAddPoint function in the map click listener
  const onAddPointRef = useRef(props.onAddPoint);
  useEffect(() => {
    onAddPointRef.current = props.onAddPoint;
  }, [props.onAddPoint]);

  useEffect(() => {
    if (!radiusRef.current || props.radiusMeters === undefined) return
    radiusRef.current.setRadius(props.radiusMeters)
    radiusRef.current.setCenter(props.center)
  }, [props.radiusMeters, props.center])

  // Handle pin moving for store location
  const storeMarkerRef = useRef<google.maps.Marker | null>(null)
  
  useEffect(() => {
    if (!mapRef.current) return
    const g = window.google
    if (!g?.maps) return
    
    if ((props as any).onStoreLocationChange && (props as any).storeLocation) {
      if (!storeMarkerRef.current) {
        storeMarkerRef.current = new g.maps.Marker({
          position: (props as any).storeLocation,
          map: mapRef.current,
          draggable: true,
          title: 'Local do Restaurante',
          icon: {
            url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
          }
        })
        
        storeMarkerRef.current.addListener('dragend', (e: google.maps.MapMouseEvent) => {
          const lat = e.latLng?.lat()
          const lng = e.latLng?.lng()
          if (lat && lng && (props as any).onStoreLocationChange) {
            (props as any).onStoreLocationChange({ lat, lng })
          }
        })
      } else {
        storeMarkerRef.current.setPosition((props as any).storeLocation)
      }
    }
  }, [(props as any).storeLocation, (props as any).onStoreLocationChange])

  useEffect(() => {
    if (!mapRef.current || !polygonRef.current) return

    const g = window.google
    if (!g?.maps) return

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []

    const path = props.points.map((p) => new g.maps.LatLng(p.lat, p.lng))
    polygonRef.current.setPaths(path)

    markersRef.current = props.points.map(
      (p, i) => {
        const isFirstPoint = i === 0;
        const marker = new g.maps.Marker({
          position: { lat: p.lat, lng: p.lng },
          map: mapRef.current!,
          clickable: isFirstPoint && isDrawingRef.current,
          title: isFirstPoint && isDrawingRef.current ? 'Clique para fechar a área' : undefined,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: isFirstPoint && isDrawingRef.current ? 7 : 5, // Make the first point slightly larger to indicate it can be clicked
            fillColor: '#f97316',
            fillOpacity: 1,
            strokeColor: isFirstPoint && isDrawingRef.current ? '#000000' : '#ffffff',
            strokeWeight: 2,
          }
        });

        if (isFirstPoint && isDrawingRef.current) {
          marker.addListener('click', () => {
            if (props.points.length >= 3) {
              setIsDrawing(false);
            }
          });
        }

        return marker;
      }
    )
  }, [props.points, isDrawing])

  // Draw line to mouse
  useEffect(() => {
    if (!mapRef.current || !polygonRef.current || !props.enabled || !isDrawing) return
    const g = window.google
    if (!g?.maps) return

    let mouseMoveListener: google.maps.MapsEventListener | null = null;
    let tempLine: google.maps.Polyline | null = null;

    if (props.points.length > 0) {
      tempLine = new g.maps.Polyline({
        map: mapRef.current,
        strokeColor: '#f97316',
        strokeOpacity: 0.5,
        strokeWeight: 2,
        clickable: false,
        path: [props.points[props.points.length - 1], props.points[props.points.length - 1]]
      });

      mouseMoveListener = mapRef.current.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
        if (e.latLng && tempLine) {
          const lastPoint = props.points[props.points.length - 1];
          tempLine.setPath([lastPoint, e.latLng]);
        }
      });
    }

    return () => {
      if (mouseMoveListener) g.maps.event.removeListener(mouseMoveListener);
      if (tempLine) tempLine.setMap(null);
    }
  }, [props.points, props.enabled])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {mapInitializationError && (
        <div className="absolute inset-x-4 bottom-4 rounded-xl border border-red-200 bg-white/95 p-3 text-sm font-medium text-red-700 shadow-lg">
          {mapInitializationError}
        </div>
      )}
    </div>
  )
}

export default function PolygonAreasEditor(props: {
  storeLocation: { lat: number; lng: number } | null
  onStoreLocationChange?: (loc: { lat: number; lng: number }) => void
  areas: PolygonAreaDraft[]
  setAreas: React.Dispatch<React.SetStateAction<PolygonAreaDraft[]>>
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}) {
  const selected = useMemo(() => props.areas.find((a) => a.id === props.selectedId) || null, [props.areas, props.selectedId])
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY
  const [googleReady, setGoogleReady] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [osmTileError, setOsmTileError] = useState(false)

  const center = useMemo(() => {
    if (selected?.points?.length) return [selected.points[0].lat, selected.points[0].lng] as [number, number]
    if (props.storeLocation) return [props.storeLocation.lat, props.storeLocation.lng] as [number, number]
    return [-15.793889, -47.882778] as [number, number]
  }, [selected, props.storeLocation])

  const polygonPositions = useMemo(() => {
    if (!selected || selected.points.length < 3) return null
    return selected.points.map((p) => [p.lat, p.lng] as [number, number])
  }, [selected])

  const addArea = () => {
    const id = makeId()
    props.setAreas((prev) => [
      ...prev,
      {
        id,
        name: `Nova Área ${prev.length + 1}`,
        delivery_fee: '0.00',
        minimum_order: '0.00',
        delivery_time: '30-45 min',
        active: true,
        points: []
      }
    ])
    props.setSelectedId(id)
  }

  const removeArea = (id: string) => {
    props.setAreas((prev) => prev.filter((a) => a.id !== id))
    if (props.selectedId === id) props.setSelectedId(null)
  }

  const updateSelected = (patch: Partial<PolygonAreaDraft>) => {
    if (!props.selectedId) return
    props.setAreas((prev) => prev.map((a) => (a.id === props.selectedId ? { ...a, ...patch } : a)))
  }

  const addPoint = (p: PolygonPoint) => {
    if (!selected) return
    updateSelected({ points: [...selected.points, p] })
  }

  const undoPoint = () => {
    if (!selected) return
    updateSelected({ points: selected.points.slice(0, -1) })
  }

  const clearPoints = () => {
    if (!selected) return
    updateSelected({ points: [] })
  }

  useEffect(() => {
    if (!googleKey) {
      setGoogleReady(false)
      setGoogleError(null)
      return
    }
    let cancelled = false
    ;(window as any).gm_authFailure = () => {
      if (cancelled) return
      setGoogleReady(false)
      setGoogleError('Falha na autenticação do Google Maps (verifique chave/restrições/billing).')
    }
    loadGoogleMaps(googleKey)
      .then(() => {
        if (cancelled) return
        setGoogleReady(true)
        setGoogleError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setGoogleReady(false)
        setGoogleError(String(e?.message || 'Erro ao carregar Google Maps'))
      })
    return () => {
      cancelled = true
      try {
        if ((window as any).gm_authFailure) delete (window as any).gm_authFailure
      } catch {}
    }
  }, [googleKey])

  return (
    <div className="flex flex-col lg:flex-row h-[600px] border rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="lg:flex-1 relative border-b lg:border-b-0 lg:border-r">
        <div className="absolute top-4 left-4 z-[400] bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow-sm border text-xs font-medium text-boracume-dark-green max-w-[80%]">
          {googleKey ? (googleReady ? 'Mapa: Google Maps' : 'Mapa: carregando Google Maps...') : 'Mapa: OpenStreetMap (fallback)'}
        </div>
        {googleKey ? (
          googleReady ? (
            <GooglePolygonMap
              key={props.selectedId || 'unselected'}
              center={{ lat: center[0], lng: center[1] }}
              enabled={!!selected}
              points={selected?.points || []}
              onAddPoint={addPoint}
              storeLocation={props.storeLocation}
              onStoreLocationChange={props.onStoreLocationChange}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground bg-gray-50">
              {googleError ? googleError : 'Carregando mapa...'}
            </div>
          )
        ) : (
          <div className="h-full w-full relative">
            <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0 }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                eventHandlers={{
                  tileerror: () => setOsmTileError(true),
                  load: () => setOsmTileError(false)
                }}
              />
              <LeafletAutoResize />
              <MapClickAdder enabled={!!selected} onAdd={addPoint} />
              {selected?.points?.map((p, idx) => (
                <CircleMarker key={idx} center={[p.lat, p.lng]} radius={5} pathOptions={{ color: '#F26522', fillColor: '#F26522', fillOpacity: 1 }} />
              ))}
              {polygonPositions && <Polygon positions={polygonPositions} pathOptions={{ color: '#F26522', fillColor: '#F26522', fillOpacity: 0.15, weight: 2 }} />}
            </MapContainer>
          </div>
        )}
        
        {/* Floating Controls Overlay */}
        {selected && (
          <div className="absolute bottom-4 left-4 right-4 lg:right-auto z-[400] bg-white/95 backdrop-blur p-2 rounded-xl shadow-lg border flex gap-2 justify-between lg:justify-start">
            <Button type="button" variant="outline" size="sm" onClick={undoPoint} disabled={selected.points.length === 0} className="rounded-lg">
              <Undo2 size={16} className="mr-2" />
              Desfazer
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={clearPoints} disabled={selected.points.length === 0} className="rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50">
              Limpar área
            </Button>
          </div>
        )}
      </div>

      <div className="w-full lg:w-[350px] xl:w-[400px] flex flex-col bg-gray-50/50">
        <div className="p-4 border-b bg-white flex items-center justify-between shrink-0">
          <div>
            <div className="font-semibold text-boracume-dark-green">Zonas de Entrega</div>
            <div className="text-xs text-muted-foreground">Gerencie suas áreas</div>
          </div>
          <Button type="button" size="sm" onClick={addArea} className="rounded-xl bg-boracume-orange hover:bg-boracume-orange/90 text-white shadow-sm">
            <Plus size={16} className="mr-1" />
            Nova
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {props.areas.length === 0 ? (
            <div className="text-sm text-center p-8 text-muted-foreground bg-white rounded-xl border border-dashed">
              Nenhuma área desenhada. Clique em "Nova" para começar.
            </div>
          ) : (
            <div className="space-y-3">
              {props.areas.map((a) => (
                <div key={a.id} className={`p-3 border rounded-xl transition-all ${props.selectedId === a.id ? 'border-boracume-orange bg-boracume-orange/5 shadow-sm' : 'bg-white hover:border-gray-300'}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <button type="button" className="text-left min-w-0 flex-1" onClick={() => props.setSelectedId(a.id)}>
                      <div className="font-semibold text-sm truncate text-boracume-dark-green">{a.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.points.length} pontos • {formatBRL(a.delivery_fee)}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant={a.active ? 'default' : 'secondary'} className={`cursor-pointer rounded-md px-1.5 py-0 text-[10px] ${a.active ? 'bg-boracume-green hover:bg-boracume-green/90' : ''}`} onClick={() => props.setAreas((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)))}>
                        {a.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" onClick={() => removeArea(a.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  
                  {props.selectedId === a.id && (
                    <div className="pt-3 border-t border-boracume-orange/10 mt-2 space-y-3 animate-fade-in">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">Nome da área</Label>
                        <Input className="h-8 text-sm rounded-lg bg-white" value={a.name} onChange={(e) => updateSelected({ name: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600">Taxa (R$)</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
                            <Input className="h-8 text-sm rounded-lg bg-white pl-8" type="number" step="0.01" value={a.delivery_fee} onChange={(e) => updateSelected({ delivery_fee: e.target.value })} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-600">Mínimo (R$)</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
                            <Input className="h-8 text-sm rounded-lg bg-white pl-8" type="number" step="0.01" value={a.minimum_order} onChange={(e) => updateSelected({ minimum_order: e.target.value })} />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">Tempo estimado</Label>
                        <Input className="h-8 text-sm rounded-lg bg-white" value={a.delivery_time} onChange={(e) => updateSelected({ delivery_time: e.target.value })} placeholder="Ex: 30-45 min" />
                      </div>
                      <div className="text-[11px] text-boracume-orange bg-boracume-orange/10 p-2 rounded-lg text-center font-medium">
                        Clique no mapa para desenhar. Clique no 1º ponto para fechar a área.
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
