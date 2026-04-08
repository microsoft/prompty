// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>§13.5 Steering — inject user messages into a running agent loop.</summary>
public class Steering
{
    private readonly object _lock = new();
    private readonly List<string> _queue = [];

    /// <summary>Enqueue a message to be injected at the next iteration.</summary>
    public void Send(string message)
    {
        lock (_lock)
        {
            _queue.Add(message);
        }
    }

    /// <summary>Remove and return all queued messages as Message objects.</summary>
    public List<Message> Drain()
    {
        lock (_lock)
        {
            var items = new List<string>(_queue);
            _queue.Clear();
            return items.Select(text =>
                new Message
                {
                    Role = "user",
                    Parts = [new TextPart { Value = text }]
                }
            ).ToList();
        }
    }

    /// <summary>Whether there are pending messages without consuming them.</summary>
    public bool HasPending
    {
        get
        {
            lock (_lock)
            {
                return _queue.Count > 0;
            }
        }
    }
}
