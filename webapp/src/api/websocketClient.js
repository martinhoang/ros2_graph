/**
 * WebSocket client for real-time ROS2 graph updates
 */

class WebSocketClient {
  constructor(url, onUpdate, onError) {
    this.url = url;
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
    this.intentionalClose = false;
  }

  connect() {
    // Don't try to reconnect if we've given up
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${this.url}`;
      
      if (this.reconnectAttempts === 0) {
        console.log(`Connecting to WebSocket: ${wsUrl}`);
      }
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        // Send initial ping to confirm connection
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send('ping');
        }
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'graph_update' && this.onUpdate) {
            this.onUpdate(message.data);
          }
        } catch (err) {
          // Ignore pong messages and other non-JSON messages
          if (event.data !== 'pong') {
            console.error('Error parsing WebSocket message:', err);
          }
        }
      };
      
      this.ws.onerror = (error) => {
        // Only log the first error to avoid spam
        if (this.reconnectAttempts === 0) {
          console.warn('WebSocket connection failed, will fall back to polling');
        }
      };
      
      this.ws.onclose = () => {
        if (!this.intentionalClose) {
          this.attemptReconnect();
        }
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      this.attemptReconnect();
    }
  }

  attemptReconnect() {
    if (this.intentionalClose) {
      return;
    }

    this.reconnectAttempts++;
    
    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      setTimeout(() => this.connect(), this.reconnectDelay);
    } else {
      console.log('WebSocket unavailable, using polling mode');
      if (this.onError) {
        this.onError(new Error('WebSocket connection failed'));
      }
    }
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export default WebSocketClient;
