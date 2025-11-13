class TopicMessageClient {
  constructor(topicName, onMessage, onError) {
    this.topicName = topicName;
    this.onMessage = onMessage;
    this.onError = onError;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      // Remove leading slash and encode path
      const encodedTopic = this.topicName
        .split('/')
        .filter(part => part !== '')
        .map(part => encodeURIComponent(part))
        .join('/');
      
      // In development, Vite will proxy /ws to the backend
      // In production, use the current host
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      const port = window.location.port ? `:${window.location.port}` : '';
      
      this.ws = new WebSocket(`${protocol}//${host}${port}/ws/topic/${encodedTopic}`);

      this.ws.onopen = () => {
        console.log(`Connected to topic: ${this.topicName}`);
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            console.error('Topic WebSocket error:', data.error);
            if (this.onError) {
              this.onError(data.error);
            }
          } else if (data.type === 'message') {
            if (this.onMessage) {
              this.onMessage(data);
            }
          }
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('Topic WebSocket error:', error);
        if (this.onError) {
          this.onError('WebSocket connection error');
        }
      };

      this.ws.onclose = () => {
        console.log(`Disconnected from topic: ${this.topicName}`);
        this.ws = null;
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      if (this.onError) {
        this.onError(error.message);
      }
    }
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.send('close');
      } catch (e) {
        // Ignore errors when closing
      }
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export default TopicMessageClient;
