
export class Tracer {
  // collection of disposables
  private static _tracers: {
    [key: string]: (name: string) => { trace: (key: string, value: any) => void, end: () => void };
  };

  public static add(
    name: string,
    tracer: (name: string) => { trace: (key: string, value: any) => void, end: () => void }
  ) {
    if (!Tracer._tracers) {
      Tracer._tracers = {};
    }
    Tracer._tracers[name] = tracer;
  }

  public static start(name: string, attributes?: { [key: string]: any }) {
    if (!Tracer._tracers) {
      Tracer._tracers = {};
    }

    // start each tracer
    const tracers = Object.keys(Tracer._tracers).map((tracer) => {
      return Tracer._tracers[tracer](name);
    });

    // trace attributes (if they exist)
    if (attributes) {
      tracers.forEach((tracer) => {
        for (const key in attributes) {
          tracer.trace(key, attributes[key]);
        }
      });
    }

    // return object with trace and disposable
    return {
      trace: (key: string, value: any) => {
        tracers.forEach((tracer) => {
          tracer.trace(key, value);
        })
      },
      end: () => {
        tracers.forEach((tracer) => {
          tracer.end();
        });
      }
    };
  }
}

function getParamNames(func: Function): string[] {
  const funcStr = func.toString();
  const result = funcStr.slice(funcStr.indexOf('(') + 1, funcStr.indexOf(')')).match(/([^\s,]+)/g);
  return result === null ? [] : result;
}

export function trace(attributes?: { [key: string]: any }) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {

    const originalMethod = descriptor.value;
    const paramNames = getParamNames(originalMethod);

    descriptor.value = function (...vargs: any[]) {
      const tracer = Tracer.start(propertyKey, attributes);
      
      const name = target.constructor.name;
      tracer.trace("signature", `${name}.${propertyKey}(${vargs.join(", ")})`);
      tracer.trace("inputs", Object.fromEntries(paramNames.map((key, index) => [key, vargs[index]])));

      const result = originalMethod.apply(this, vargs);
      if (result instanceof Promise) {
        return new Promise((resolve, reject) => {
          result.then((res) => {
            tracer.trace("outputs", res);
            tracer.end();
            resolve(res);
          }).catch((err) => {
            tracer.trace("error", err);
            tracer.end();
            reject(err);
          });
        });
      } else {
        tracer.trace("outputs", result);
        tracer.end();
        return result;
      }
    };

    return descriptor;
  };
}
