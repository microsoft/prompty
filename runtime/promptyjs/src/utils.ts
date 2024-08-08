import * as fs from "fs/promises"

export class utils {
    static async importModuleSync(moduleName: string): Promise <any> {
        const importedModule = import(moduleName);
        return importedModule;
    }

    static isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

    static async readFileSafe(filePath: string, encoding: BufferEncoding = 'utf-8') : Promise < string > {
        if (utils.isNode) {
            const data = await fs.readFile(filePath, encoding);
            return data
        } else {
            throw new Error("Load from file not supported in browser")
        }
    }

    static paramHoisting(
        top: Record<string, any>, 
        bottom: Record<string, any>, 
        topKey: string | null = null
      ): Record<string, any> {
        let newDict: Record<string, any> = {};
      
        if (topKey) {
          newDict = topKey in top ? { ...top[topKey] } : {};
        } else {
          newDict = { ...top };
        }
      
        for (const key in bottom) {
          if (!(key in newDict)) {
            newDict[key] = bottom[key];
          }
        }
      
        return newDict;
    }
}