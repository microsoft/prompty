using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Prompty.Core
{
    public class Settings
    {
        public Dictionary<string, object> Items { get; set; } = [];
        public Settings() { }
        public Settings(Dictionary<string, object>? items)
        {
            Items = items ?? [];
        }
    }
}
