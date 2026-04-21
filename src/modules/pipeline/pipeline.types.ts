export interface IngestCommandOptions {
  branch?: string
  verbose?: boolean
  force?: boolean
  source?: string
  noRebalance?: boolean
}

export interface IngestSummary {
  adapterId: string
  itemsProduced: number
  materialProcessed: number
  groupsProcessed: number
}

export interface IngestResult {
  adapters: IngestSummary[]
  totalItemsProduced: number
  filesAffected: number
  rebalance: { moves: number; splits: number; merges: number }
  isIncremental: boolean
  warningsLogged: number
}
