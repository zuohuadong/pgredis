/** 不支持命令时抛出的标准错误 */
export class UnsupportedCommandError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`Unsupported Redis command: ${command}. This command is not available in @postgresx/noredis.`);
    this.name = "UnsupportedCommandError";
    this.command = command;
  }
}
