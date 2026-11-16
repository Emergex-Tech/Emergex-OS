import { NextResponse } from 'next/server'
import { ApiError } from './auth'

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}
