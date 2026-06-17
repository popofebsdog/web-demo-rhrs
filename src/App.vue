<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type RhrsLayer = 1 | 2 | 3

type RhrsNodeType = 'outcome' | 'event' | 'factor_group' | 'factor' | 'form' | 'field'

type RhrsNode = {
  id: string
  label: string
  type: RhrsNodeType
  typeLabel: string
  layer: RhrsLayer
  role?: string
  summary?: string
  originalText?: string
  sourcePdf?: string
  sourcePdfUrl?: string
}

type RhrsEdge = {
  id: string
  from: string
  to: string
  relation: string
  type: string
  operator?: string
  note?: string
}

type RhrsGraph = {
  title: string
  description?: string
  formula?: string
  formSchemaSummary?: string
  rootNodeId: string
  nodes: RhrsNode[]
  edges: RhrsEdge[]
  sourceFiles?: {
    graph: string
    formSchema: string
    pdfs: string[]
  }
}

type PositionedNode = RhrsNode & {
  depth: number
  x: number
  y: number
  radius: number
  lines: string[]
}

type LayerMeta = {
  title: string
  shortTitle: string
  description: string
  stroke: string
  fill: string
}

const layerMeta: Record<RhrsLayer, LayerMeta> = {
  1: {
    title: '殘餘風險 / 事件',
    shortTitle: '風險事件',
    description: '殘餘風險與邊坡失穩事件核心',
    stroke: '#184f68',
    fill: '#e5f2f7',
  },
  2: {
    title: 'A/B/C/D 因果因子',
    shortTitle: '因果因子',
    description: '環境因子、觸發、後果暴露與防護折減',
    stroke: '#6f5a16',
    fill: '#f6edcf',
  },
  3: {
    title: '表單欄位 / 來源',
    shortTitle: '表單來源',
    description: '現場欄位與檢測表單資料來源',
    stroke: '#23604d',
    fill: '#e4f2ec',
  },
}

const graph = ref<RhrsGraph>({
  title: 'RHRS 易致災因果知識圖譜',
  rootNodeId: 'RISK',
  nodes: [],
  edges: [],
})
const selectedNodeId = ref('')
const searchQuery = ref('')
const loadError = ref('')
const activeNav = ref<'interpretation' | 'form'>('interpretation')
const isInterpretationOpen = ref(false)
const isFormOutputOpen = ref(false)
const hasInterpretedPhoto = ref(false)
const pathPlaybackStep = ref(0)
const pathPlaybackTimer = ref<number | null>(null)
const highlightedLayer = ref<RhrsLayer | null>(null)
const graphScale = ref(1)
const graphPan = ref({ x: 0, y: 0 })
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0, originX: 0, originY: 0 })

const workflowExtractedFields = [
  { group: 'A 環境因子', field: '岩性 / 坡度 / 裸露岩面', value: '可見高陡岩坡與風化裸露面' },
  { group: 'A 環境因子', field: '湧水 / 排水 / 坡面乾濕', value: '坡面濕痕與排水管位置可辨識' },
  { group: 'C 後果暴露', field: '落石尺寸 / 道路寬度 / 交通暴露', value: '坡腳落石鄰近車道' },
  { group: 'D 防護', field: '護欄 / 排水設施 / 防護成效', value: '現有設施可折減但仍需評估' },
]

const photoAnnotations = [
  { label: '裸露岩面', x: 58, y: 14, width: 26, height: 42 },
  { label: '湧水/排水管', x: 50, y: 52, width: 18, height: 18 },
  { label: '坡腳落石', x: 50, y: 72, width: 38, height: 16 },
  { label: '道路暴露', x: 4, y: 65, width: 38, height: 24 },
]

const interpretationPathNodeIds = [
  'EVENT',
  'A',
  'A1',
  'FLD_坡度',
  'A2',
  'FLD_岩性',
  'A3',
  'FLD_地下水',
  'C',
  'C2',
  'FLD_崩落物料',
  'D',
  'D1',
  'FLD_設施檢查',
  'RISK',
]

const thinkingSteps = [
  '辨識照片中的高陡裸露岩面、風化岩層與坡面濕痕。',
  '將影像線索映射到 A 環境因子、B 觸發、C 後果暴露、D 防護折減。',
  '沿 RHRS 圖譜追溯量測欄位與來源表單。',
  '套用殘餘風險公式產出判勢結果與建議表單草稿。',
]

const suggestedFormRows = [
  { category: 'A 環境因子', field: '岩性 / 坡度 / 坡型', value: '高陡岩坡、裸露岩面，坡面風化與局部土砂裸露明顯。', risk: '環境風險偏高' },
  { category: 'A 環境因子', field: '植被覆蓋 / 湧水 / 排水', value: '坡面可見濕痕與排水管，局部植被覆蓋不足。', risk: '需追蹤' },
  { category: 'B 觸發', field: '天氣 / 坡面乾濕', value: '照片呈現雨後潮濕坡面，需結合近期降雨量。', risk: '觸發條件成立時升高' },
  { category: 'C 後果暴露', field: '落石尺寸 / 道路寬度', value: '坡腳落石堆積鄰近車道，通行車輛可能受影響。', risk: '暴露偏高' },
  { category: 'D 防護', field: '護欄 / 排水設施 / 監測', value: '有道路護欄與排水設施，但未見完整落石防護或監測資訊。', risk: '折減有限' },
]

const nodeById = computed(() => new Map(graph.value.nodes.map((node) => [node.id, node])))

const selectedNode = computed(() => {
  return nodeById.value.get(selectedNodeId.value) ?? graph.value.nodes[0]
})

const activePathNodeIds = computed(() => new Set(interpretationPathNodeIds.slice(0, pathPlaybackStep.value)))

const currentPathNode = computed(() => {
  const currentId = interpretationPathNodeIds[Math.max(0, Math.min(pathPlaybackStep.value - 1, interpretationPathNodeIds.length - 1))]
  return nodeById.value.get(currentId)
})

const visibleNodes = computed(() => graph.value.nodes)
const visibleNodeIds = computed(() => new Set(visibleNodes.value.map((node) => node.id)))
const visibleEdges = computed(() => graph.value.edges.filter((edge) => visibleNodeIds.value.has(edge.from) && visibleNodeIds.value.has(edge.to)))

const outgoingByNode = computed(() => {
  const map = new Map<string, RhrsEdge[]>()
  for (const edge of graph.value.edges) {
    map.set(edge.from, [...(map.get(edge.from) ?? []), edge])
  }
  return map
})

const nodeDepthById = computed(() => {
  const depths = new Map<string, number>()
  const baseDepthByType: Record<RhrsNodeType, number> = {
    outcome: 0,
    event: 1,
    factor_group: 2,
    factor: 3,
    field: 4,
    form: 5,
  }

  for (const node of graph.value.nodes) {
    depths.set(node.id, baseDepthByType[node.type] ?? 4)
  }

  for (const edge of graph.value.edges) {
    const fromDepth = depths.get(edge.from)
    if (fromDepth === undefined) {
      continue
    }

    if (edge.relation === 'contains' || edge.relation === 'measured_by' || edge.relation === 'sourced_from') {
      const currentDepth = depths.get(edge.to) ?? 5
      depths.set(edge.to, Math.max(currentDepth, fromDepth + 1))
    }
  }

  return depths
})

const positionedNodes = computed<PositionedNode[]>(() => {
  const factorGroupOrder = ['A', 'B', 'C', 'D']
  const groupXById = new Map(factorGroupOrder.map((id, index) => [id, 250 + index * 340]))
  const factorGroups = new Set(factorGroupOrder)
  const factorParentById = new Map<string, string>()
  const fieldsByFactorId = new Map<string, RhrsNode[]>()
  const formIndexById = new Map<string, number>()

  for (const edge of graph.value.edges) {
    if (edge.relation === 'contains' && factorGroups.has(edge.from)) {
      factorParentById.set(edge.to, edge.from)
    }
  }

  for (const edge of graph.value.edges) {
    if (edge.relation === 'measured_by') {
      const field = nodeById.value.get(edge.to)
      if (field) {
        fieldsByFactorId.set(edge.from, [...(fieldsByFactorId.get(edge.from) ?? []), field])
      }
    }
  }

  graph.value.nodes
    .filter((node) => node.type === 'form')
    .forEach((node, index) => formIndexById.set(node.id, index))

  const factorIndexByParent = new Map<string, Map<string, number>>()
  for (const groupId of factorGroupOrder) {
    const factorIds = graph.value.edges.filter((edge) => edge.from === groupId && edge.relation === 'contains').map((edge) => edge.to)
    factorIndexByParent.set(groupId, new Map(factorIds.map((id, index) => [id, index])))
  }

  const fieldPositionById = new Map<string, { x: number; y: number }>()
  for (const [factorId, fields] of fieldsByFactorId.entries()) {
    const parentId = factorParentById.get(factorId) ?? 'A'
    const baseX = groupXById.get(parentId) ?? 250
    const factorIndex = factorIndexByParent.get(parentId)?.get(factorId) ?? 0
    const factorY = 440 + factorIndex * 185
    const spacing = fields.length > 4 ? 84 : 90
    const startX = baseX - ((fields.length - 1) * spacing) / 2
    fields.forEach((field, index) => {
      fieldPositionById.set(field.id, { x: startX + index * spacing, y: factorY + 86 })
    })
  }

  return visibleNodes.value.map((node) => {
    const depth = nodeDepthById.value.get(node.id) ?? 4
    const lines = splitLabel(node.label)

    if (depth === 0) {
      return { ...node, depth, x: 760, y: 210, radius: 76, lines }
    }

    if (node.type === 'event') {
      return { ...node, depth, x: 760, y: 86, radius: 68, lines }
    }

    if (node.type === 'factor_group') {
      return { ...node, depth, x: groupXById.get(node.id) ?? 250, y: 280, radius: 66, lines }
    }

    if (node.type === 'factor') {
      const parentId = factorParentById.get(node.id) ?? 'A'
      const factorIndex = factorIndexByParent.get(parentId)?.get(node.id) ?? 0
      return { ...node, depth, x: groupXById.get(parentId) ?? 250, y: 440 + factorIndex * 185, radius: 56, lines }
    }

    if (node.type === 'field') {
      const position = fieldPositionById.get(node.id) ?? { x: 250, y: 620 }
      return { ...node, depth, x: position.x, y: position.y, radius: 36, lines }
    }

    if (node.type === 'form') {
      const index = formIndexById.get(node.id) ?? 0
      return { ...node, depth, x: 250 + index * 340, y: 1420, radius: 52, lines }
    }

    return { ...node, depth, x: 760, y: 210, radius: 60, lines }
  })
})

const positionedNodeById = computed(() => new Map(positionedNodes.value.map((node) => [node.id, node])))

const layerCounts = computed(() =>
  ([1, 2, 3] as const).map((layer) => ({
    layer,
    ...layerMeta[layer],
    count: graph.value.nodes.filter((node) => node.layer === layer).length,
  })),
)

const searchResults = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword) {
    return []
  }
  return graph.value.nodes
    .filter((node) =>
      [node.id, node.label, node.typeLabel, node.summary, node.sourcePdf]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(keyword)),
    )
    .slice(0, 8)
})

const selectedRelations = computed(() => {
  const node = selectedNode.value
  if (!node) {
    return []
  }
  return graph.value.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .map((edge) => ({
      edge,
      direction: edge.from === node.id ? 'out' : 'in',
      node: nodeById.value.get(edge.from === node.id ? edge.to : edge.from),
    }))
    .filter((item): item is { edge: RhrsEdge; direction: 'out' | 'in'; node: RhrsNode } => Boolean(item.node))
})

const sourceLinks = computed(() => {
  const files = graph.value.sourceFiles
  if (!files) {
    return []
  }
  return [
    { label: files.graph, url: '/data/rhrs-source-graph.json' },
    { label: files.formSchema, url: '/data/rhrs-form-schema.json' },
    ...files.pdfs.map((pdf) => ({ label: pdf, url: `/pdfs/${encodeURIComponent(pdf)}` })),
  ]
})

const laneGuides = computed(() => {
  const labels: Record<string, string> = {
    A: 'A 環境因子',
    B: 'B 觸發',
    C: 'C 後果暴露',
    D: 'D 防護折減',
  }

  return ['A', 'B', 'C', 'D'].map((id, index) => ({
    id,
    label: labels[id],
    x: 80 + index * 340,
    y: 230,
    width: 300,
    height: 1240,
  }))
})

const factorHierarchy = computed(() => {
  return graph.value.nodes
    .filter((node) => node.type === 'factor_group')
    .map((group) => {
      const factors = graph.value.edges
        .filter((edge) => edge.from === group.id && edge.relation === 'contains')
        .map((edge) => nodeById.value.get(edge.to))
        .filter((node): node is RhrsNode => Boolean(node))
        .map((factor) => {
          const fields = graph.value.edges
            .filter((edge) => edge.from === factor.id && edge.relation === 'measured_by')
            .map((edge) => nodeById.value.get(edge.to))
            .filter((node): node is RhrsNode => Boolean(node))
          return { factor, fields }
        })
      return { group, factors }
    })
})

const graphTransform = computed(() => {
  return `translate(${graphPan.value.x} ${graphPan.value.y}) translate(760 650) scale(${graphScale.value}) translate(-760 -650)`
})

function splitLabel(label: string) {
  if (label.length <= 8) {
    return [label]
  }
  const clean = label.replace(/[()（）]/g, ' ')
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((word) => word.length <= 8)) {
    return words.slice(0, 3)
  }
  const lines: string[] = []
  for (let index = 0; index < label.length; index += 7) {
    lines.push(label.slice(index, index + 7))
  }
  return lines.slice(0, 4)
}

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId
}

function openInterpretation() {
  activeNav.value = 'interpretation'
  isInterpretationOpen.value = true
  hasInterpretedPhoto.value = false
}

function closeInterpretation() {
  isInterpretationOpen.value = false
}

function openFormOutput() {
  activeNav.value = 'form'
  isFormOutputOpen.value = true
}

function closeFormOutput() {
  isFormOutputOpen.value = false
}

function stopPathPlayback() {
  if (pathPlaybackTimer.value !== null) {
    window.clearInterval(pathPlaybackTimer.value)
    pathPlaybackTimer.value = null
  }
}

function startInterpretationResult() {
  stopPathPlayback()
  activeNav.value = 'interpretation'
  isInterpretationOpen.value = true
  hasInterpretedPhoto.value = true
  highlightedLayer.value = null
  pathPlaybackStep.value = 1
  selectedNodeId.value = interpretationPathNodeIds[0]

  pathPlaybackTimer.value = window.setInterval(() => {
    if (pathPlaybackStep.value >= interpretationPathNodeIds.length) {
      stopPathPlayback()
      selectedNodeId.value = 'RISK'
      return
    }
    pathPlaybackStep.value += 1
    selectedNodeId.value = interpretationPathNodeIds[pathPlaybackStep.value - 1]
  }, 650)
}

function toggleLayer(layer: RhrsLayer) {
  highlightedLayer.value = highlightedLayer.value === layer ? null : layer
}

function isNodeMuted(node: RhrsNode) {
  return highlightedLayer.value !== null && highlightedLayer.value !== node.layer
}

function isEdgeMuted(edge: RhrsEdge) {
  if (highlightedLayer.value === null) {
    return false
  }
  const from = nodeById.value.get(edge.from)
  const to = nodeById.value.get(edge.to)
  return from?.layer !== highlightedLayer.value && to?.layer !== highlightedLayer.value
}

function isEdgeSelected(edge: RhrsEdge) {
  const node = selectedNode.value
  return Boolean(node && (edge.from === node.id || edge.to === node.id))
}

function isNodePathHighlighted(nodeId: string) {
  return activePathNodeIds.value.has(nodeId)
}

function isEdgePathHighlighted(edge: RhrsEdge) {
  return activePathNodeIds.value.has(edge.from) && activePathNodeIds.value.has(edge.to)
}

function edgeRelationClass(edge: RhrsEdge) {
  return `relation-${edge.relation.replace(/[^a-z_]/g, '')}`
}

function edgePath(edge: RhrsEdge) {
  const from = positionedNodeById.value.get(edge.from)
  const to = positionedNodeById.value.get(edge.to)
  if (!from || !to) {
    return ''
  }

  if (edge.relation === 'contains' || edge.relation === 'measured_by' || edge.relation === 'sourced_from') {
    const midY = from.y + (to.y - from.y) * 0.52
    return `M ${from.x} ${from.y} C ${from.x} ${midY} ${to.x} ${midY} ${to.x} ${to.y}`
  }

  const dx = to.x - from.x
  const dy = to.y - from.y
  const curve = Math.min(90, Math.hypot(dx, dy) * 0.16)
  const cx = (from.x + to.x) / 2 - (dy / Math.max(1, Math.hypot(dx, dy))) * curve
  const cy = (from.y + to.y) / 2 + (dx / Math.max(1, Math.hypot(dx, dy))) * curve
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`
}

function edgeLabelPosition(edge: RhrsEdge) {
  const from = positionedNodeById.value.get(edge.from)
  const to = positionedNodeById.value.get(edge.to)
  if (!from || !to) {
    return { x: 0, y: 0 }
  }
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
}

function zoomIn() {
  graphScale.value = Math.min(1.8, Number((graphScale.value + 0.1).toFixed(2)))
}

function zoomOut() {
  graphScale.value = Math.max(0.55, Number((graphScale.value - 0.1).toFixed(2)))
}

function resetView() {
  graphScale.value = 1
  graphPan.value = { x: 0, y: 0 }
}

function zoomWithWheel(event: WheelEvent) {
  graphScale.value = Math.min(1.8, Math.max(0.55, Number((graphScale.value + (event.deltaY > 0 ? -0.08 : 0.08)).toFixed(2))))
}

function startPan(event: PointerEvent) {
  if (!(event.currentTarget instanceof SVGElement)) {
    return
  }
  isPanning.value = true
  panStart.value = {
    x: event.clientX,
    y: event.clientY,
    originX: graphPan.value.x,
    originY: graphPan.value.y,
  }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function movePan(event: PointerEvent) {
  if (!isPanning.value) {
    return
  }
  graphPan.value = {
    x: panStart.value.originX + event.clientX - panStart.value.x,
    y: panStart.value.originY + event.clientY - panStart.value.y,
  }
}

function endPan(event: PointerEvent) {
  isPanning.value = false
  if (event.currentTarget instanceof SVGElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
}

onMounted(async () => {
  try {
    const response = await fetch('/data/graph.json')
    if (!response.ok) {
      throw new Error(`讀取 RHRS graph.json 失敗：${response.status}`)
    }
    graph.value = (await response.json()) as RhrsGraph
    selectedNodeId.value = graph.value.rootNodeId
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '讀取 RHRS 資料時發生未知錯誤'
  }
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="title-stack">
        <span>RHRS Demo</span>
        <h1>{{ graph.title }}</h1>
      </div>

      <div class="formula-strip" aria-label="風險公式">
        <span>殘餘風險公式</span>
        <strong>{{ graph.formula || '殘餘風險 = (A 環境因子 × B 觸發) × C 後果暴露 ÷ D 防護' }}</strong>
      </div>

      <nav class="product-nav" aria-label="主要功能">
        <button type="button" class="nav-action" :class="{ active: activeNav === 'interpretation' }" @click="openInterpretation">智慧判勢</button>
        <button type="button" class="nav-action" :class="{ active: activeNav === 'form' }" @click="openFormOutput">建議表單</button>
      </nav>

      <div class="global-search">
        <input v-model="searchQuery" type="search" aria-label="搜尋節點、欄位或表單" placeholder="搜尋節點、欄位或表單" />
        <div v-if="searchResults.length" class="search-results">
          <button v-for="node in searchResults" :key="node.id" type="button" @click="selectNode(node.id)">
            <strong>{{ node.label }}</strong>
            <span>{{ node.id }} · {{ node.typeLabel }}</span>
          </button>
        </div>
      </div>
    </header>

    <section v-if="loadError" class="error-state">
      {{ loadError }}
    </section>

    <section v-else class="workspace">
      <aside class="side-panel" aria-label="圖層控制">
        <header>
          <span>控制面板</span>
          <strong>圖層高亮</strong>
        </header>
        <div class="layer-list">
          <button
            v-for="item in layerCounts"
            :key="item.layer"
            type="button"
            :class="{ active: highlightedLayer === item.layer }"
            @click="toggleLayer(item.layer)"
          >
            <span>
              <strong>{{ item.shortTitle }}</strong>
              <small>{{ item.count }} 個節點</small>
            </span>
            <i :style="{ background: item.stroke }" aria-hidden="true"></i>
          </button>
        </div>

        <section class="hierarchy-box">
          <h2>因果階層</h2>
          <div class="hierarchy-list">
            <article v-for="item in factorHierarchy" :key="item.group.id">
              <button type="button" @click="selectNode(item.group.id)">
                <strong>{{ item.group.id }}</strong>
                <span>{{ item.group.label }}</span>
              </button>
              <div class="factor-list">
                <button v-for="entry in item.factors" :key="entry.factor.id" type="button" @click="selectNode(entry.factor.id)">
                  <strong>{{ entry.factor.id }}</strong>
                  <span>{{ entry.factor.label }}</span>
                  <small>{{ entry.fields.length }} 個量測欄位</small>
                </button>
              </div>
            </article>
          </div>
        </section>

        <section class="source-box">
          <h2>資料來源</h2>
          <p>{{ graph.description }}</p>
          <a v-for="source in sourceLinks" :key="source.url" :href="source.url" target="_blank" rel="noreferrer">
            {{ source.label }}
          </a>
        </section>
      </aside>

      <section class="graph-panel" aria-label="RHRS 因果知識圖譜">
        <div class="panel-header">
          <div>
            <span>Graph</span>
            <h2>因果知識圖譜</h2>
          </div>
          <div class="graph-stats">
            {{ visibleNodes.length }} 個節點 · {{ visibleEdges.length }} 條關係
          </div>
        </div>

        <div class="graph-canvas">
          <div v-if="pathPlaybackStep > 0 && currentPathNode" class="graph-path-hint">
            <span>圖譜判釋路徑</span>
            <strong>Step {{ pathPlaybackStep }} / {{ interpretationPathNodeIds.length }}：{{ currentPathNode.label }}</strong>
          </div>

          <svg
            viewBox="20 0 1480 1540"
            role="img"
            aria-label="RHRS 易致災因果知識圖譜"
            :class="{ panning: isPanning }"
            @pointerdown="startPan"
            @pointermove="movePan"
            @pointerup="endPan"
            @pointercancel="endPan"
            @wheel.prevent="zoomWithWheel"
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            <g :transform="graphTransform">
              <g class="lane-guides" aria-hidden="true">
                <g v-for="lane in laneGuides" :key="lane.id">
                  <rect :x="lane.x" :y="lane.y" :width="lane.width" :height="lane.height" rx="10" />
                  <text :x="lane.x + 16" :y="lane.y + 28">{{ lane.label }}</text>
                </g>
              </g>

              <path
                v-for="edge in visibleEdges"
                :key="edge.id"
                class="edge"
                :class="[edgeRelationClass(edge), { muted: isEdgeMuted(edge), selected: isEdgeSelected(edge), 'path-highlight': isEdgePathHighlighted(edge) }]"
                :d="edgePath(edge)"
                marker-end="url(#arrow)"
              />
              <text
                v-for="edge in visibleEdges"
                :key="`label-${edge.id}`"
                class="edge-label"
                :class="[edgeRelationClass(edge), { muted: isEdgeMuted(edge), selected: isEdgeSelected(edge) }]"
                :x="edgeLabelPosition(edge).x"
                :y="edgeLabelPosition(edge).y"
              >
                {{ edge.type }}
              </text>

              <g
                v-for="node in positionedNodes"
                :key="node.id"
                class="svg-node"
                role="button"
                tabindex="0"
                :aria-label="`查看 ${node.label}`"
                @click.stop="selectNode(node.id)"
                @keydown.enter="selectNode(node.id)"
                @keydown.space.prevent="selectNode(node.id)"
              >
                <circle
                  :cx="node.x"
                  :cy="node.y"
                  :r="node.radius"
                  :fill="layerMeta[node.layer].fill"
                  :stroke="layerMeta[node.layer].stroke"
                  :class="{ selected: selectedNodeId === node.id, muted: isNodeMuted(node), 'path-highlight': isNodePathHighlighted(node.id) }"
                />
                <text :x="node.x" :y="node.y" text-anchor="middle" :class="{ muted: isNodeMuted(node) }">
                  <tspan :x="node.x" :dy="`${-(node.lines.length - 1) * 9}px`">{{ node.id }}</tspan>
                  <tspan v-for="(line, index) in node.lines" :key="`${node.id}-${line}`" :x="node.x" :dy="index === 0 ? '19px' : '17px'">
                    {{ line }}
                  </tspan>
                </text>
              </g>
            </g>
          </svg>

          <div class="zoom-controls" aria-label="圖譜縮放">
            <button type="button" aria-label="放大" @click="zoomIn">+</button>
            <button type="button" @click="resetView">{{ Math.round(graphScale * 100) }}%</button>
            <button type="button" aria-label="縮小" @click="zoomOut">-</button>
          </div>
        </div>
      </section>

      <aside class="detail-panel" aria-label="節點詳情">
        <article v-if="selectedNode" class="detail-card">
          <header>
            <span>{{ selectedNode.id }} · {{ selectedNode.typeLabel }}</span>
            <h2>{{ selectedNode.label }}</h2>
            <p>{{ selectedNode.summary || '此節點尚未建立摘要。' }}</p>
          </header>

          <section class="detail-section">
            <h3>圖層</h3>
            <div class="layer-pill" :style="{ color: layerMeta[selectedNode.layer].stroke, background: layerMeta[selectedNode.layer].fill }">
              {{ layerMeta[selectedNode.layer].title }}
            </div>
          </section>

          <section class="detail-section">
            <h3>資料來源</h3>
            <a v-if="selectedNode.sourcePdfUrl" :href="selectedNode.sourcePdfUrl" target="_blank" rel="noreferrer">
              {{ selectedNode.sourcePdf }}
            </a>
            <span v-else>{{ selectedNode.sourcePdf || 'RHRS 轉換資料' }}</span>
          </section>

          <section class="detail-section">
            <h3>關聯節點</h3>
            <div v-if="selectedRelations.length" class="relation-list">
              <button v-for="item in selectedRelations" :key="item.edge.id" type="button" @click="selectNode(item.node.id)">
                <span>{{ item.direction === 'out' ? '指向' : '來源' }} · {{ item.edge.type }}</span>
                <strong>{{ item.node.label }}</strong>
                <small v-if="item.edge.note">{{ item.edge.note }}</small>
              </button>
            </div>
            <p v-else>此節點目前沒有直接關聯。</p>
          </section>

          <section class="detail-section">
            <h3>原始節點</h3>
            <pre>{{ selectedNode.originalText }}</pre>
          </section>
        </article>
      </aside>
    </section>

    <div v-if="isInterpretationOpen" class="modal-backdrop" role="presentation" @click.self="closeInterpretation">
      <section class="interpretation-modal" role="dialog" aria-modal="true" aria-labelledby="interpretation-title">
        <header class="modal-header">
          <div>
            <span>智慧判勢</span>
            <h2 id="interpretation-title">依圖判勢邊坡照片</h2>
          </div>
          <button type="button" aria-label="關閉智慧判勢" @click="closeInterpretation">×</button>
        </header>

        <div class="interpretation-body">
          <section class="photo-review">
            <div class="photo-frame modal-photo-frame">
              <img src="/demo-images/rhrs-slope-demo.png" alt="邊坡道路現場照片" />
              <template v-if="hasInterpretedPhoto">
                <span
                  v-for="annotation in photoAnnotations"
                  :key="annotation.label"
                  class="annotation-box"
                  :style="{
                    left: `${annotation.x}%`,
                    top: `${annotation.y}%`,
                    width: `${annotation.width}%`,
                    height: `${annotation.height}%`,
                  }"
                >
                  {{ annotation.label }}
                </span>
              </template>
            </div>
          </section>

          <section class="thinking-panel">
            <span>{{ hasInterpretedPhoto ? '判勢結果' : '思考流程' }}</span>
            <h3>{{ hasInterpretedPhoto ? '疑似雨後邊坡落石與排水異常風險' : '照片線索 → RHRS 圖譜 → 殘餘風險' }}</h3>
            <ol v-if="!hasInterpretedPhoto">
              <li v-for="step in thinkingSteps" :key="step">{{ step }}</li>
            </ol>
            <p v-else class="judgment-summary">標註框已顯示影像判讀位置；主畫面圖譜正在高亮 RHRS 判釋路徑。</p>
            <div v-if="hasInterpretedPhoto" class="finding-list">
              <button v-for="item in workflowExtractedFields" :key="`${item.group}-${item.field}`" type="button">
                <span>{{ item.group }}</span>
                <strong>{{ item.field }}</strong>
                <small>{{ item.value }}</small>
              </button>
            </div>
            <div v-if="hasInterpretedPhoto" class="risk-output-card compact">
              <span>Output</span>
              <strong>中高風險，建議現地複查</strong>
              <p>殘餘風險 = (A 環境因子 × B 觸發) × C 後果暴露 ÷ D 防護</p>
            </div>
            <div class="modal-actions">
              <button type="button" class="secondary-action" @click="closeInterpretation">取消</button>
              <button v-if="!hasInterpretedPhoto" type="button" class="primary-action" @click="startInterpretationResult">開始判勢</button>
              <button v-else type="button" class="primary-action" @click="openFormOutput">產生建議表單</button>
            </div>
          </section>
        </div>
      </section>
    </div>

    <div v-if="isFormOutputOpen" class="modal-backdrop" role="presentation" @click.self="closeFormOutput">
      <section class="form-output-modal" role="dialog" aria-modal="true" aria-labelledby="form-output-title">
        <header class="modal-header">
          <div>
            <span>建議表單</span>
            <h2 id="form-output-title">邊坡照片判讀欄位回填</h2>
          </div>
          <button type="button" aria-label="關閉建議表單" @click="closeFormOutput">×</button>
        </header>

        <div class="form-stage-grid modal-form-grid">
          <div class="form-table">
            <div class="form-row form-row-head">
              <span>因子</span>
              <span>欄位</span>
              <span>照片判讀內容</span>
              <span>風險提示</span>
            </div>
            <button v-for="row in suggestedFormRows" :key="`${row.category}-${row.field}`" type="button" class="form-row">
              <strong>{{ row.category }}</strong>
              <span>{{ row.field }}</span>
              <span>{{ row.value }}</span>
              <span>{{ row.risk }}</span>
            </button>
          </div>

          <div class="risk-output-card">
            <span>Output</span>
            <strong>殘餘風險結果</strong>
            <p>殘餘風險 = (A 環境因子 × B 觸發) × C 後果暴露 ÷ D 防護</p>
            <div>
              <span>目前判定</span>
              <strong>中高風險，建議現地複查</strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
