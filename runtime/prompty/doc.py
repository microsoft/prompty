from inspect import getmembers, isclass, isfunction

import prompty


def build():
    fn = [
        f for f in getmembers(prompty, isfunction) if f[1].__module__.startswith("prompty")
    ]
    cl = [
        s for s in getmembers(prompty, isclass) if s[1].__module__.startswith("prompty")
    ]

    d = {
        "prompty": [
            {"function": f[0], "module": f[1].__module__, "doc": f[1].__doc__} for f in fn
        ],
    }

    for c in cl:
        if c[1].__module__ in d:
            d[c[1].__module__].append(
                {"class": c[0], "module": c[1].__module__, "doc": c[1].__doc__}
            )
        else:
            d[c[1].__module__] = [
                {"class": c[0], "module": c[1].__module__, "doc": c[1].__doc__}
            ]

    print("DONE!")


if __name__ == "__main__":
    build()
