import { trace, Tracer } from "../src/tracer";

const injectable = (name: string) => {
  console.log(`1 => starting ${name} trace (injectable)`);

  return {
    trace: (key: string, value: any) => {
      console.log(`2 => tracing "${key}" with value ${JSON.stringify(value)} (injectable)`);
    },
    end: () => {
      console.log(`3 => closing ${name} (injectable)`);
    }
  };
}

const injectable2 = (name: string) => {
  console.log(`1 => starting ${name} trace (injectable 2)`);

  return {
    trace: (key: string, value: any) => {
      console.log(`2 => tracing "${key}" with value ${JSON.stringify(value)} (injectable 2)`);
    },
    end: () => {
      console.log(`3 => closing ${name} (injectable 2)`);
    }
  };
}

class test {

  @trace({ nonasync: "true" })
  public static testTrace(arg: string) {
    return arg + "!";
  }


  @trace({ nonasync: "true" })
  public static testOther(arg: string, arg2: string) {
    return arg + " " + arg2 + "!";
  }

  static timeout(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  @trace({ nonasync: "false" })
  public static async testTraceAsync(arg: string): Promise<string> {
    // do something async
    await test.timeout(10);
    return arg + " testTraceAsync!";
  }
}

beforeEach(() => {
  Tracer.add("injectable", injectable);
  Tracer.add("injectable2", injectable2);
});


it("sync method decoration trace should pass", () => {
  const res = test.testTrace("hello");
  expect(res).toBe("hello!");
});

it("async method decoration trace should pass", async () => {
  const res = await test.testTraceAsync("hello");
  expect(res).toBe("hello testTraceAsync!");
});

it("sync method decoration trace with multiple args should pass", () => {
  const res = test.testOther("hello", "there");
  expect(res).toBe("hello there!");
});
