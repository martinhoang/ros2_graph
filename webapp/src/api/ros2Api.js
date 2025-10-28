import axios from 'axios';

const API_BASE_URL = '/api';

export const fetchGraphData = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/graph`);
    return response.data;
  } catch (error) {
    console.error('Error fetching graph data:', error);
    throw new Error('Failed to connect to ROS2 backend. Make sure the backend server is running.');
  }
};

export const fetchNodeInfo = async (nodeName) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/node/${encodeURIComponent(nodeName)}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching node info:', error);
    throw error;
  }
};

export const fetchTopicInfo = async (topicName) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/topic/${encodeURIComponent(topicName)}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching topic info:', error);
    throw error;
  }
};
