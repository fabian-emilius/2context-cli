import { Global, Module } from '@nestjs/common'

import { TerminalUI } from './terminal-ui.js'

@Global()
@Module({
  providers: [TerminalUI],
  exports: [TerminalUI],
})
export class UIModule {}
