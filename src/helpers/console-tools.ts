import readline from 'node:readline'

export async function askConsoleString(prompt: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const suffix = defaultValue ? ` (${defaultValue})` : ''

  return new Promise((resolve) => {
    rl.question(`${prompt}${suffix}: `, (answer) => {
      rl.close()
      resolve(answer || defaultValue || '')
    })
  })
}

export async function askConsoleObject<T>(
  prompt: string,
  availableOptions: T[],
  formatter: (x: T) => string = (x) => String(x),
): Promise<T> {
  console.log(`\n${prompt}\n${availableOptions.map((row, index) => `  ${index}: ${formatter(row)}`).join('\n')}`)

  while (true) {
    const answer = await askConsoleNumber('Selection')

    if (answer >= 0 && answer < availableOptions.length) {
      return availableOptions[answer]
    }

    console.log('Please enter a valid number')
  }
}

export async function askConsoleNumber(prompt: string): Promise<number> {
  while (true) {
    const answer = await askConsoleString(prompt)
    const parsed = parseInt(answer, 10)

    if (!isNaN(parsed)) {
      return parsed
    }

    console.log('Please enter a valid number')
  }
}

export async function askConsoleBoolean(prompt: string): Promise<boolean> {
  const answer = await askConsoleString(`${prompt} (y/n)`)

  return (
    answer.toLowerCase() === 'yes' ||
    answer.toLowerCase() === 'y' ||
    answer.toLowerCase() === 'true' ||
    answer.toLowerCase() === '1'
  )
}

export async function askConsoleSecret(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    // Mask input for API keys
    const stdin = process.stdin
    const originalRawMode = stdin.isRaw

    if (stdin.isTTY) {
      stdin.setRawMode(true)
    }

    let input = ''

    process.stdout.write(`${prompt}: `)

    const onData = (char: Buffer) => {
      const c = char.toString('utf8')

      if (c === '\n' || c === '\r' || c === '\u0004') {
        stdin.removeListener('data', onData)
        if (stdin.isTTY && originalRawMode !== undefined) {
          stdin.setRawMode(originalRawMode)
        }
        process.stdout.write('\n')
        rl.close()
        resolve(input)
      } else if (c === '\u007F' || c === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(0)
      } else {
        input += c
        process.stdout.write('*')
      }
    }

    stdin.on('data', onData)
    stdin.resume()
  })
}
