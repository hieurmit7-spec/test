import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Brain } from 'lucide-react';
import OpenAI from 'openai';
import { supabase } from './lib/supabase';

// Initialize OpenAI client for NVIDIA NIM
const openai = new OpenAI({
  apiKey: import.meta.env.VITE_NVIDIA_NIM_API_KEY || 'dummy-key',
  baseURL: import.meta.env.VITE_NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  dangerouslyAllowBrowser: true // Required for client-side usage
});

const NIM_MODEL = import.meta.env.VITE_NVIDIA_NIM_MODEL || 'deepseek-ai/deepseek-v3.2';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  timestamp: Date;
};

// Generate or retrieve a session ID for the user
const getSessionId = () => {
  let sessionId = localStorage.getItem('chat_session_id');
  if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('chat_session_id', sessionId);
  }
  return sessionId;
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const sessionId = getSessionId();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isInitializing]);

  // Load chat history from Supabase on mount
  useEffect(() => {
    const fetchHistory = async () => {
      if (!supabase) {
        setMessages([{
          id: '1',
          role: 'assistant',
          content: 'Hello! I am your AI assistant. How can I help you today?',
          timestamp: new Date()
        }]);
        setIsInitializing(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true });

        if (error) console.error('Error fetching chat history:', error);

        if (data && data.length > 0) {
          const history = data.map(msg => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            // Assuming we don't save reasoning to DB yet, or if we do it's stored in content
            timestamp: new Date(msg.created_at)
          }));
          setMessages(history);
        } else {
          const initialMessage: Message = {
            id: '1',
            role: 'assistant',
            content: 'Hello! I am your AI assistant powered by DeepSeek. How can I help you today?',
            timestamp: new Date()
          };
          setMessages([initialMessage]);
          await supabase.from('messages').insert({
            session_id: sessionId,
            role: 'assistant',
            content: initialMessage.content
          });
        }
      } catch (err) {
        console.error('Failed to load history', err);
      } finally {
        setIsInitializing(false);
      }
    };

    fetchHistory();
  }, [sessionId]);

  const saveMessageToSupabase = async (role: string, content: string) => {
    if (!supabase) return;
    try {
      await supabase.from('messages').insert({
        session_id: sessionId,
        role,
        content
      });
    } catch (err) {
      console.error('Failed to save message:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userContent = input.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userContent,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Save user message to Supabase
    await saveMessageToSupabase('user', userContent);

    // Placeholder for bot message while streaming
    const botMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: botMsgId,
      role: 'assistant',
      content: '',
      reasoning: '',
      timestamp: new Date()
    }]);

    try {
      const apiMessages = messages.concat(userMessage).map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const stream = await openai.chat.completions.create({
        model: NIM_MODEL,
        messages: apiMessages as any,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 8192,
        stream: true,
        // @ts-ignore - Extra body parameter for DeepSeek thinking
        extra_body: { "chat_template_kwargs": { "thinking": true } }
      });

      let fullContent = '';
      let fullReasoning = '';

      for await (const chunk of stream) {
        if (!chunk.choices) continue;
        
        const delta = chunk.choices[0]?.delta as any;
        const chunkReasoning = delta?.reasoning_content || '';
        const chunkContent = delta?.content || '';

        if (chunkReasoning) fullReasoning += chunkReasoning;
        if (chunkContent) fullContent += chunkContent;

        setMessages(prev => prev.map(msg => 
          msg.id === botMsgId 
            ? { ...msg, content: fullContent, reasoning: fullReasoning } 
            : msg
        ));
      }

      // Save bot message to Supabase after stream finishes
      // Note: We only save the final content to the DB for simplicity, 
      // but you can adjust DB schema to save fullReasoning if needed.
      await saveMessageToSupabase('assistant', fullContent);
      
    } catch (error: any) {
      console.error('Chat API Error:', error);
      setMessages(prev => prev.map(msg => 
        msg.id === botMsgId 
          ? { ...msg, content: `Sorry, I encountered an error: ${error.message}` } 
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chatbot-container">
      <header className="chat-header">
        <div className="chat-header-icon">
          <Sparkles color="white" size={20} />
        </div>
        <div className="chat-header-info">
          <h1>DeepSeek Assistant</h1>
          <p>
            <span className="status-dot"></span>
            Online • Powered by NVIDIA NIM
          </p>
        </div>
      </header>

      <main className="chat-messages">
        {isInitializing ? (
          <div className="message bot">
            <div className="message-content">
              Loading chat history...
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.role === 'user' ? 'user' : 'bot'}`}>
                <div className="avatar">
                  {message.role === 'user' ? <User color="white" size={20} /> : <Bot color="white" size={20} />}
                </div>
                <div className="message-content">
                  {message.reasoning && (
                    <div className="reasoning-box">
                      <div className="reasoning-header">
                        <Brain size={14} /> <span>Thinking Process</span>
                      </div>
                      <div className="reasoning-text">
                        {message.reasoning}
                      </div>
                    </div>
                  )}
                  {message.content && <p>{message.content}</p>}
                  {!message.content && !message.reasoning && isLoading && message.role === 'assistant' && (
                    <div className="typing-indicator">
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                    </div>
                  )}
                  {(message.content || message.reasoning) && (
                    <div className="message-time">{formatTime(message.timestamp)}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </main>

      <div className="chat-input-container">
        <form onSubmit={handleSubmit} className="chat-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message here..."
            className="chat-input"
            disabled={isLoading || isInitializing}
          />
          <button type="submit" className="send-button" disabled={!input.trim() || isLoading || isInitializing}>
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;
