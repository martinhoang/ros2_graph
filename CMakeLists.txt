cmake_minimum_required(VERSION 3.8)
project(ros2_graph)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(ament_cmake_python REQUIRED)
find_package(rclpy REQUIRED)

# Install Python backend
install(PROGRAMS
  backend/ros2_graph_server.py
  DESTINATION lib/${PROJECT_NAME}
)

install(FILES
  backend/pyproject.toml
  DESTINATION share/${PROJECT_NAME}/backend
)

# Install launch script
install(PROGRAMS
  launch.sh
  DESTINATION lib/${PROJECT_NAME}
)

# Install webapp files
install(DIRECTORY
  webapp/
  DESTINATION share/${PROJECT_NAME}/webapp
  PATTERN "node_modules" EXCLUDE
  PATTERN "dist" EXCLUDE
  PATTERN ".vite" EXCLUDE
)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  # the following line skips the linter which checks for copyrights
  # comment the line when a copyright and license is added to all source files
  set(ament_cmake_copyright_FOUND TRUE)
  # the following line skips cpplint (only works in a git repo)
  # comment the line when this package is in a git repo and when
  # a copyright and license is added to all source files
  set(ament_cmake_cpplint_FOUND TRUE)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()

