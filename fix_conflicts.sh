#!/bin/bash
git checkout --theirs frontend/src/workspace/ChatWorkspace.tsx
git checkout --theirs frontend/src/workspace/ToolActivity.tsx

# In Message.tsx, we want the origin/main signature but with our Orb UI!
git checkout --theirs frontend/src/components/Message.tsx
