/** 带 HTTP 状态码的业务错误 */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.status = status
    this.code = code
    this.name = 'HttpError'
  }
}

/** 统一返回 404，用于对无权访问者隐藏资源的存在 */
export function notFoundError(message = '资源不存在'): HttpError {
  return new HttpError(404, message, 'not_found')
}
