// oxlint-disable
/**
 * One-time entity secret registration.
 * Generates a 32-byte secret, registers it with Circle,
 * writes CIRCLE_ENTITY_SECRET to .env, and saves the recovery file.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { registerEntitySecretCiphertext } from '@circle-fin/developer-controlled-wallets'

const apiKey = process.env.CIRCLE_API_KEY
if (!apiKey) {
  console.error('CIRCLE_API_KEY not set')
  process.exit(1)
}

const entitySecret = crypto.randomBytes(32).toString('hex')

const recoveryDir = '/home/user/app/.circle'
fs.mkdirSync(recoveryDir, { recursive: true })

console.log('Registering entity secret with Circle...')
const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDir,
})

if (!response.data) {
  console.error('Registration failed:', JSON.stringify(response))
  process.exit(1)
}

const recoveryPath = path.join(recoveryDir, 'recovery_file.dat')
if (response.data.recoveryFile) {
  fs.writeFileSync(recoveryPath, response.data.recoveryFile)
}

// Persist to .env
const envPath = path.join('/home/user/app', '.env')
fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, 'utf-8')

console.log('Entity secret registered and saved to .env')
console.log('Recovery file written to:', recoveryPath)
console.log('Registration OK:', !!response.data)
