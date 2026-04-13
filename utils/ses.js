import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses'

export async function sendInviteEmail ({ to, inviteUrl, account, inviterName }) {
  const { sesRegion, sesEmail, sesKey, sesSecret } = useRuntimeConfig()

  const client = new SESClient({
    region: sesRegion,
    credentials: {
      accessKeyId: sesKey,
      secretAccessKey: sesSecret
    }
  })

  const inviterText = inviterName ? ` by <strong>${inviterName}</strong>` : ''
  const inviterPlainText = inviterName ? ` by ${inviterName}` : ''

  const storage = useStorage('assets:server')
  const htmlTemplate = await storage.getItem('emails/invite.html')
  const textTemplate = await storage.getItem('emails/invite.txt')

  const html = htmlTemplate
    .replaceAll('{{inviterText}}', inviterText)
    .replaceAll('{{account}}', account)
    .replaceAll('{{inviteUrl}}', inviteUrl)

  const text = textTemplate
    .replaceAll('{{inviterPlainText}}', inviterPlainText)
    .replaceAll('{{account}}', account)
    .replaceAll('{{inviteUrl}}', inviteUrl)

  await client.send(new SendEmailCommand({
    Source: sesEmail,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: {
        Data: `You've been invited to join Entu database ${account}`,
        Charset: 'UTF-8'
      },
      Body: {
        Html: {
          Data: html,
          Charset: 'UTF-8'
        },
        Text: {
          Data: text,
          Charset: 'UTF-8'
        }
      }
    }
  }))
}
