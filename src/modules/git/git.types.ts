export interface CommitInfo {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
}

export interface CommitDiff {
  commit: CommitInfo
  files: FileDiff[]
}

export interface FileDiff {
  filename: string
  additions: number
  deletions: number
  binary: boolean
  diff: string | null
}

export interface RepoInfo {
  rootDir: string
  currentBranch: string
  remoteUrl: string | null
  name: string
}
