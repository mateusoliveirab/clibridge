export interface RoleDemand {
  cost?: 'cheap' | 'any'
  strength?: 'high' | 'any'
  capabilities?: Array<'structuredOutput' | 'images' | 'sandbox' | 'skipPermissions'>
}

export interface Gate {
  verify?: string
  assert?: string
  onFail?: 'report' | 'stop'
}

export interface FanOut {
  count: 'all-writers' | number
}

export interface Phase {
  name: string
  role: string
  demand: RoleDemand
  input?: string
  output?: 'text' | 'structured'
  skipPermissions?: boolean
  readOnly?: boolean
  parallel?: boolean
  fanOut?: FanOut
  gate?: Gate
  confirmIfDestructive?: boolean
}

export interface WorkflowPattern {
  name: string
  description: string
  whenToUse: string
  antiPattern: string
  phases: Phase[]
}

export type WorkflowsConfig = Record<string, WorkflowPattern>
