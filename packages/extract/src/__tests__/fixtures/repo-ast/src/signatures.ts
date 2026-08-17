const Controller = (...args: unknown[]): ClassDecorator => {
  void args;
  return (target) => {
    void target;
  };
};
const Get = (...args: unknown[]): MethodDecorator => {
  void args;
  return (target, propertyKey, descriptor) => {
    void target;
    void propertyKey;
    void descriptor;
  };
};

@Controller("root")
export class DemoController {
  @Get("/users")
  list() {
    return "ok";
  }

  constructor() {
    const apiKey = process.env.API_KEY;
    const short = "short-value";
    const long =
      "this string literal is intentionally longer than one hundred characters to verify filtering in signature extraction";
    void apiKey;
    void short;
    void long;
  }
}

export const handler = () => {
  return process.env.SERVICE_NAME;
};
