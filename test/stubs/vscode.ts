class UriStub {
  readonly scheme: string;
  readonly path: string;
  readonly query: string;
  readonly fsPath: string;

  constructor(scheme: string, path: string, query: string, fsPath: string) {
    this.scheme = scheme;
    this.path = path;
    this.query = query;
    this.fsPath = fsPath;
  }

  static from(value: {
    scheme: string;
    path?: string;
    query?: string;
    fsPath?: string;
  }): UriStub {
    return new UriStub(
      value.scheme,
      value.path ?? '',
      value.query ?? '',
      value.fsPath ?? value.path ?? '',
    );
  }

  static file(fsPath: string): UriStub {
    return new UriStub('file', fsPath, '', fsPath);
  }
}

export { UriStub as Uri };
