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
    // Split by '/', filter out empty strings (from leading '/'), encode parts, then join
    const parts = nodeName.split('/').filter(part => part !== '');
    const encodedName = parts.map(part => encodeURIComponent(part)).join('/');
    const response = await axios.get(`${API_BASE_URL}/node/${encodedName}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching node info:', error);
    throw error;
  }
};

export const fetchTopicInfo = async (topicName) => {
  try {
    // Split by '/', filter out empty strings (from leading '/'), encode parts, then join
    const parts = topicName.split('/').filter(part => part !== '');
    const encodedName = parts.map(part => encodeURIComponent(part)).join('/');
    const response = await axios.get(`${API_BASE_URL}/topic/${encodedName}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching topic info:', error);
    throw error;
  }
};
