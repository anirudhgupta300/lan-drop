import Ably from 'ably'
import { NextResponse } from 'next/server'

export async function GET() {
    const client = new Ably.Rest(process.env.ABLY_API_KEY!)
    const token = await client.auth.createTokenRequest({ clientId: 'lan-drop' })
    return NextResponse.json(token)
}