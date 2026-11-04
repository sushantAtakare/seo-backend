class ApiResponse {
  /**
   * @param {number} statusCode HTTP status code
   * @param {unknown} [data=null] Response payload
   * @param {string} [message='Success'] Human-readable message
   */
  constructor(statusCode, data = null, message = 'Success') {
    this.success = statusCode >= 200 && statusCode < 300;
    this.message = message;
    this.data = data;
  }
}

export default ApiResponse;
