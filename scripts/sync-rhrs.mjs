import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const projectDir = resolve(dirname(currentFile), '..')
const rhrsDir = resolve(projectDir, '..')

const sourceGraphPath = resolve(rhrsDir, '台2線70k+000~70k+350_知識圖譜.json')
const sourceFormPath = resolve(rhrsDir, '台2線70k+000~70k+350_表單架構.json')
const targetDataPath = resolve(projectDir, 'public/data/graph.json')
const targetRawGraphPath = resolve(projectDir, 'public/data/rhrs-source-graph.json')
const targetRawFormPath = resolve(projectDir, 'public/data/rhrs-form-schema.json')
const targetPdfDir = resolve(projectDir, 'public/pdfs')
const graphInputPath = existsSync(sourceGraphPath) ? sourceGraphPath : targetRawGraphPath
const formInputPath = existsSync(sourceFormPath) ? sourceFormPath : targetRawFormPath

const sourceGraph = JSON.parse(readFileSync(graphInputPath, 'utf8'))
const sourceForm = JSON.parse(readFileSync(formInputPath, 'utf8'))

const pdfFiles = ['04_台2線70k+000~70k+350.pdf', '18616_台2線易致災.pdf']

const typeLabels = {
  outcome: '殘餘風險',
  event: '失穩事件',
  factor_group: '因果群組',
  factor: '評估因子',
  form: '來源表單',
  field: '表單欄位',
}

const relationLabels = {
  contains: '包含',
  triggers: '觸發',
  amplifies: '放大',
  mitigates: '折減',
  measured_by: '由欄位量測',
  sourced_from: '來源表單',
}

function nodeLayer(type) {
  if (type === 'outcome' || type === 'event') {
    return 1
  }
  if (type === 'factor_group' || type === 'factor') {
    return 2
  }
  return 3
}

function nodeSummary(node) {
  const parts = []
  if (node.role) {
    parts.push(node.role)
  }
  if (node['對應']) {
    parts.push(`對應：${node['對應']}`)
  }
  if (node['取值法']) {
    parts.push(`取值法：${node['取值法']}`)
  }
  return parts.join('；') || `${typeLabels[node.type] ?? node.type}：${node.label}`
}

function nodeSource(node) {
  if (node.type === 'form') {
    return '18616_台2線易致災.pdf'
  }
  if (node.type === 'field') {
    return '台2線70k+000~70k+350_表單架構.json'
  }
  return '台2線70k+000~70k+350_知識圖譜.json'
}

function nodeSourceUrl(node) {
  if (node.type === 'form') {
    return '/pdfs/18616_台2線易致災.pdf'
  }
  return undefined
}

function edgeLabel(edge) {
  const label = relationLabels[edge.relation] ?? edge.relation
  return edge.operator ? `${label} ${edge.operator}` : label
}

const converted = {
  title: 'RHRS 易致災因果知識圖譜',
  description: sourceGraph['graph_說明'],
  formula: sourceGraph['風險公式'] ?? sourceForm['風險公式'],
  formSchemaSummary: sourceForm['schema_說明'],
  rootNodeId: 'RISK',
  nodes: sourceGraph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    typeLabel: typeLabels[node.type] ?? node.type,
    layer: nodeLayer(node.type),
    role: node.role,
    operator: node.operator,
    summary: nodeSummary(node),
    originalText: JSON.stringify(node, null, 2),
    sourcePdf: nodeSource(node),
    sourcePdfUrl: nodeSourceUrl(node),
  })),
  edges: sourceGraph.edges.map((edge, index) => ({
    id: `rhrs-edge-${index + 1}`,
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    type: edgeLabel(edge),
    operator: edge.operator,
    note: edge.note,
  })),
  sourceFiles: {
    graph: '台2線70k+000~70k+350_知識圖譜.json',
    formSchema: '台2線70k+000~70k+350_表單架構.json',
    pdfs: pdfFiles,
  },
}

mkdirSync(dirname(targetDataPath), { recursive: true })
mkdirSync(targetPdfDir, { recursive: true })

writeFileSync(targetDataPath, `${JSON.stringify(converted, null, 2)}\n`)
if (sourceGraphPath !== targetRawGraphPath && existsSync(sourceGraphPath)) {
  copyFileSync(sourceGraphPath, targetRawGraphPath)
}
if (sourceFormPath !== targetRawFormPath && existsSync(sourceFormPath)) {
  copyFileSync(sourceFormPath, targetRawFormPath)
}

for (const pdfFile of pdfFiles) {
  const sourcePdfPath = resolve(rhrsDir, pdfFile)
  const targetPdfPath = resolve(targetPdfDir, pdfFile)
  if (sourcePdfPath !== targetPdfPath && existsSync(sourcePdfPath)) {
    copyFileSync(sourcePdfPath, targetPdfPath)
  }
}

console.log(`Synced RHRS graph: ${graphInputPath} -> ${targetDataPath}`)
console.log(`Copied ${pdfFiles.length} PDFs -> ${targetPdfDir}`)
